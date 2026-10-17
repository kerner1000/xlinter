import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * Packed-contents guard: every package.json `files` entry must put at least
 * one path into the tarball, and every packed path must come from a `files`
 * entry or from the root files npm always packs. npm expands a literal
 * directory entry to its contents, but a glob entry only re-includes the paths
 * it matches itself, so a glob over directories packs nothing and npm stays
 * silent about it.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const execFileAsync = promisify(execFile);

/** Root files npm packs regardless of `files`: package.json, README, LICENSE/LICENCE, COPYING. */
const ALWAYS_PACKED = /^(package\.json|(readme|copying|licen[cs]e)(\..+)?)$/i;

/** Whether a packed path falls under a `files` entry (the entry itself or anything below it). */
function covers(entry: string, file: string): boolean {
  const pattern = entry.replace(/^\.?\/+/, "").replace(/\/+$/, "");
  // A literal directory covers hidden descendants too; matchesGlob excludes them.
  return (
    file === pattern ||
    file.startsWith(`${pattern}/`) ||
    path.matchesGlob(file, pattern) ||
    path.matchesGlob(file, `${pattern}/**`)
  );
}

interface PackAudit {
  /** `files` entries that match no packed path. */
  deadEntries: string[];
  /** Packed paths that no `files` entry covers and npm does not pack by default. */
  unlistedFiles: string[];
}

function auditPack(entries: readonly string[], packed: readonly string[]): PackAudit {
  return {
    deadEntries: entries.filter((entry) => !packed.some((file) => covers(entry, file))),
    unlistedFiles: packed.filter(
      (file) => !ALWAYS_PACKED.test(file) && !entries.some((entry) => covers(entry, file)),
    ),
  };
}

/** The paths `npm pack` would put into the tarball, relative to the package root. */
async function packedPaths(root = projectRoot): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  );
  const [pack] = JSON.parse(stdout) as { files: { path: string }[] }[];
  if (!pack) throw new Error(`npm pack --json printed no package: ${stdout}`);
  return pack.files.map((f) => f.path);
}

describe("published package contents", () => {
  it("every files entry packs a path and every packed path is listed", async () => {
    const manifest = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8")) as {
      files?: string[];
    };
    const entries = manifest.files ?? [];
    expect(entries, "package.json must declare a files allowlist").not.toEqual([]);
    expect(
      auditPack(entries, await packedPaths()),
      "each files entry must pack >=1 path; every packed path must be listed (npm pack --dry-run)",
    ).toEqual({ deadEntries: [], unlistedFiles: [] });
  });

  it("reports an entry that packs nothing", () => {
    const packed = ["package.json", "dist/index.js"];
    expect(auditPack(["dist", "src/rules/*/fixtures"], packed)).toEqual({
      deadEntries: ["src/rules/*/fixtures"],
      unlistedFiles: [],
    });
  });

  it("accepts a glob entry that matches packed files", () => {
    const packed = ["dist/index.js", "src/rules/nodes/fixtures/valid/a/x.yaml"];
    expect(auditPack(["dist", "src/rules/*/fixtures/**"], packed)).toEqual({
      deadEntries: [],
      unlistedFiles: [],
    });
  });

  it("reports a packed path that no entry lists", () => {
    const packed = ["README.md", "LICENSE", "dist/index.js", "tsconfig.json"];
    expect(auditPack(["dist"], packed)).toEqual({
      deadEntries: [],
      unlistedFiles: ["tsconfig.json"],
    });
  });

  it("covers hidden directory descendants without covering a sibling directory", async () => {
    const root = fileURLToPath(new URL("./repos/packlist/", import.meta.url));
    const packed = await packedPaths(root);
    expect(packed).toEqual(
      expect.arrayContaining([
        "docs/.example.json",
        "docs/.examples/snippet.json",
        "docs-extra/.example.json",
      ]),
    );
    expect(auditPack(["docs"], packed)).toEqual({
      deadEntries: [],
      unlistedFiles: ["docs-extra/.example.json"],
    });
  });
});
