import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readdir, realpath, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import ignoreFactory from "ignore";
import type { ResolvedConfig } from "../config/types.js";
import { XlinterConfigError } from "../config/types.js";
import type { Target, TargetRoot } from "../rule/types.js";

const execFileAsync = promisify(execFile);

/**
 * Resolve every root's file targets. Discovery is `tracked` (git ls-files) or
 * a gitignore-aware `walk`; `auto` picks tracked when the root is a git repo.
 * Nested checkouts are pruned, symlinked directories are never followed, and
 * targets are deduplicated by realpath across roots (symlink-published trees
 * must be linted once).
 */
export async function resolveTargets(config: ResolvedConfig): Promise<{
  roots: TargetRoot[];
  targets: Target[];
}> {
  const baseDir = path.dirname(config.file);
  const roots: TargetRoot[] = [];
  const targets: Target[] = [];
  const seen = new Set<string>();
  const ig = ignoreFactory().add(config.ignore);

  for (const rootSpec of config.roots) {
    const absPath = path.resolve(baseDir, rootSpec.path);
    if (!existsSync(absPath)) {
      throw XlinterConfigError.single(`root does not exist: ${rootSpec.path} (${absPath})`, {
        file: config.file,
      });
    }
    const isGit = existsSync(path.join(absPath, ".git"));
    const root: TargetRoot = {
      absPath,
      kind: rootSpec.kind,
      ...(isGit ? { git: { present: true as const } } : {}),
    };
    roots.push(root);

    const mode =
      config.discovery === "auto" ? (isGit ? "tracked" : "walk") : config.discovery;
    if (mode === "tracked" && !isGit) {
      throw XlinterConfigError.single(
        `discovery "tracked" requires a git repository, but ${absPath} is not one`,
        { file: config.file },
      );
    }
    const relPaths = mode === "tracked" ? await gitLsFiles(absPath) : await walk(absPath);

    for (const rel of relPaths) {
      if (ig.ignores(rel)) continue;
      const abs = path.join(absPath, rel);
      let st;
      try {
        st = await lstat(abs);
      } catch {
        continue; // e.g. tracked but deleted from the working tree
      }
      if (st.isDirectory()) continue;
      const nodeType = st.isSymbolicLink() ? ("symlink" as const) : ("file" as const);
      let real: string;
      try {
        real = await realpath(abs);
      } catch {
        real = abs; // broken symlink: keep, dedup by lexical path
      }
      if (seen.has(real)) continue;
      seen.add(real);
      targets.push({ absPath: abs, relPath: rel, root, nodeType });
    }
  }
  targets.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { roots, targets };
}

async function gitLsFiles(rootAbs: string): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", rootAbs, "ls-files", "-z"],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.split("\0").filter((s) => s.length > 0);
}

async function walk(rootAbs: string): Promise<string[]> {
  const out: string[] = [];
  const gitignore = ignoreFactory();
  try {
    gitignore.add(await readFile(path.join(rootAbs, ".gitignore"), "utf8"));
  } catch {
    // no .gitignore — fine
  }
  async function recurse(dirAbs: string, dirRel: string): Promise<void> {
    const entries = await readdir(dirAbs, { withFileTypes: true });
    for (const entry of entries) {
      const rel = dirRel === "" ? entry.name : `${dirRel}/${entry.name}`;
      if (entry.name === ".git") continue;
      if (entry.isDirectory()) {
        if (gitignore.ignores(`${rel}/`)) continue;
        // Prune nested checkouts: any non-root directory carrying its own .git.
        if (existsSync(path.join(dirAbs, entry.name, ".git"))) continue;
        await recurse(path.join(dirAbs, entry.name), rel);
      } else {
        if (gitignore.ignores(rel)) continue;
        out.push(rel);
      }
    }
  }
  await recurse(rootAbs, "");
  return out;
}

/** Instance-scope matcher over relPaths, gitignore-pattern semantics. */
export function scopeMatcher(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): (relPath: string) => boolean {
  const inc = include && include.length > 0 ? ignoreFactory().add([...include]) : undefined;
  const exc = exclude && exclude.length > 0 ? ignoreFactory().add([...exclude]) : undefined;
  return (relPath: string) => {
    if (inc && !inc.ignores(relPath)) return false;
    if (exc && exc.ignores(relPath)) return false;
    return true;
  };
}
