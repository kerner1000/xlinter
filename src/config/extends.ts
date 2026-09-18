import { readFile, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as resolveModule } from "import-meta-resolve";
import { parse as parseYaml } from "yaml";
import { validateRawConfig } from "./schema.js";
import { mergeConfigs } from "./merge.js";
import { XlinterConfigError, type RawConfig, type ResolvedConfig } from "./types.js";

export const CONFIG_FILENAMES = [".xlinter.yaml", ".xlinter.yml"];

/** Walk up from `startDir` to the nearest config file (stops at a git root or fs root). */
export function discoverConfigFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    for (const name of CONFIG_FILENAMES) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const atGitRoot = existsSync(path.join(dir, ".git"));
    const parent = path.dirname(dir);
    if (atGitRoot || parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load a config file, resolve its extends chain (DFS, left-to-right,
 * child-last so the child wins in the merge), detect cycles by realpath,
 * merge, and gate on the engine version range.
 */
export async function loadConfig(
  entryFile: string,
  engineVersion: string,
): Promise<ResolvedConfig> {
  const layers: RawConfig[] = [];
  const visited = new Set<string>();
  await loadLayer(path.resolve(entryFile), [], visited, layers);
  const resolved = mergeConfigs(layers);
  if (resolved.engine !== undefined && !satisfies(engineVersion, resolved.engine)) {
    throw XlinterConfigError.single(
      `config requires engine "${resolved.engine}" but this xlinter is ${engineVersion}`,
      { file: resolved.file },
    );
  }
  return resolved;
}

async function loadLayer(
  file: string,
  stack: string[],
  visited: Set<string>,
  out: RawConfig[],
): Promise<void> {
  let real: string;
  try {
    real = await realpath(file);
  } catch {
    throw XlinterConfigError.single(`config file not found: ${file}`);
  }
  if (stack.includes(real)) {
    throw XlinterConfigError.single(
      `extends cycle: ${[...stack, real].map((p) => path.basename(p)).join(" -> ")}`,
      { file: real },
    );
  }
  if (visited.has(real)) return; // diamond: merge once
  visited.add(real);

  let content: string;
  try {
    content = await readFile(real, "utf8");
  } catch (e) {
    throw XlinterConfigError.single(
      `cannot read config file ${real}: ${(e as Error).message}`,
    );
  }
  let data: unknown;
  try {
    data = parseYaml(content);
  } catch (e) {
    throw XlinterConfigError.single(`invalid YAML in ${real}: ${(e as Error).message}`, {
      file: real,
    });
  }
  const raw = validateRawConfig(data, real);

  for (const spec of raw.extends) {
    const resolvedSpec = await resolveExtend(spec, real);
    await loadLayer(resolvedSpec, [...stack, real], visited, out);
  }
  out.push(raw);
}

/**
 * Resolve one extends entry. `./` and `../` are relative to the extending file.
 * A bare name resolves an npm preset package's exported `./xlinter.yaml`.
 * URLs are rejected (reserved for a future version).
 */
async function resolveExtend(spec: string, fromFile: string): Promise<string> {
  if (/^[a-z]+:\/\//i.test(spec)) {
    throw XlinterConfigError.single(
      `URL extends is not supported in this xlinter version: "${spec}"`,
      { file: fromFile },
    );
  }
  if (spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec)) {
    return path.resolve(path.dirname(fromFile), spec);
  }
  try {
    const url = resolveModule(`${spec}/xlinter.yaml`, pathToFileURL(fromFile).href);
    return fileURLToPath(url);
  } catch (e) {
    throw XlinterConfigError.single(
      `cannot resolve extends "${spec}" — a preset package must export "./xlinter.yaml" (${(e as Error).message})`,
      { file: fromFile },
    );
  }
}

/**
 * Minimal semver-range check: comparators (`>=`, `>`, `<=`, `<`, `=`), caret
 * (`^x.y.z`), or a bare version; space-separated comparators are ANDed.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVer(version);
  if (!v) return false;
  const clauses = range.trim().split(/\s+/);
  for (const clause of clauses) {
    const m = /^(\^|>=|<=|>|<|=)?(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)$/.exec(clause);
    if (!m) return false;
    const op = m[1] ?? "=";
    const bound = parseVer(m[2] ?? "");
    if (!bound) return false;
    const c = compare(v, bound);
    switch (op) {
      case "=":
        if (c !== 0) return false;
        break;
      case ">=":
        if (c < 0) return false;
        break;
      case ">":
        if (c <= 0) return false;
        break;
      case "<=":
        if (c > 0) return false;
        break;
      case "<":
        if (c >= 0) return false;
        break;
      case "^": {
        if (c < 0) return false;
        // Same leading non-zero component (0.x pairs on minor).
        const upper: [number, number, number] =
          bound[0] > 0 ? [bound[0] + 1, 0, 0] : [0, bound[1] + 1, 0];
        if (compare(v, upper) >= 0) return false;
        break;
      }
    }
  }
  return true;
}

function parseVer(s: string): [number, number, number] | undefined {
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-[0-9A-Za-z.-]+)?$/.exec(s.trim());
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] as number) - (b[i] as number);
    if (d !== 0) return d;
  }
  return 0;
}
