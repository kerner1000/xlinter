import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = path.join(projectRoot, "dist", "cli", "main.js");
const reposDir = fileURLToPath(new URL("./repos/", import.meta.url));
const repo = (name: string): string => path.join(reposDir, name);
const presetDirs: string[] = [];

afterAll(async () => {
  for (const dir of presetDirs) await rm(dir, { recursive: true, force: true });
});

const PRESET_EMPTY = "version: 1\nnamespace: preset\n";
/** A preset layer that fails the engine gate when it is the one loaded. */
const PRESET_POISON = 'version: 1\nnamespace: preset\nengine: ">=99"\n';
/** A preset layer that contributes one rule instance when it is the one loaded. */
const PRESET_ONE_RULE = [
  "version: 1",
  "namespace: preset",
  "rules:",
  "  docs:",
  "    type: file-name",
  '    targets: { include: ["*.md"] }',
  '    pattern: "^[a-z0-9-]+[.]md$"',
  "",
].join("\n");

interface PresetFixture {
  /** The `exports` field of the `@acme/preset` package. */
  exports: Record<string, unknown>;
  /** Preset package files beside the default empty `xlinter.yaml`. */
  files?: Record<string, string>;
  /** The consumer's `extends` entry. */
  extend?: string;
  /** Temp directory prefix (a space in it exercises URL decoding). */
  prefix?: string;
}

/**
 * A consumer config at `<dir>/config/.xlinter.yaml` extending a preset package installed in
 * its own `node_modules`.
 */
async function createPresetFixture(fixture: PresetFixture): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), fixture.prefix ?? "xlinter-preset-"));
  presetDirs.push(dir);
  const configDir = path.join(dir, "config");
  const packageDir = path.join(configDir, "node_modules", "@acme", "preset");
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "@acme/preset", version: "1.0.0", exports: fixture.exports }),
  );
  const files: Record<string, string> = { "xlinter.yaml": PRESET_EMPTY, ...fixture.files };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(packageDir, name), content);
  }
  await writeFile(
    path.join(configDir, ".xlinter.yaml"),
    `version: 1\nnamespace: consumer\nextends: ["${fixture.extend ?? "@acme/preset"}"]\n`,
  );
  return dir;
}

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn the built CLI; a non-zero exit is a result, never a test crash. */
function runCli(args: string[], cwd: string, nodeArgs: string[] = []): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [...nodeArgs, cliPath, ...args],
      { cwd, timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          reject(error); // spawn failure / timeout, not an exit code
          return;
        }
        resolve({ code: error ? (error.code as number) : 0, stdout, stderr });
      },
    );
  });
}

describe("built CLI (dist/cli/main.js)", () => {
  it("lint on basic repo exits 1 and --format json emits the schemaVersion-1 envelope", async () => {
    const { code, stdout } = await runCli(["--format", "json"], repo("basic"));
    expect(code).toBe(1);
    const envelope = JSON.parse(stdout) as {
      schemaVersion: number;
      failed: boolean;
      findings: { ruleId: string; kind: string }[];
      instances: unknown[];
      summary: unknown;
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.failed).toBe(true);
    expect(envelope.findings.some((f) => f.ruleId === "local/doc-names")).toBe(true);
    expect(envelope.instances.length).toBeGreaterThan(0);
  });

  it("lint on clean repo exits 0", async () => {
    const { code } = await runCli([], repo("clean"));
    expect(code).toBe(0);
  });

  it("validate-config on basic repo's config exits 0", async () => {
    const { code, stdout } = await runCli(["validate-config", ".xlinter.yaml"], repo("basic"));
    expect(code).toBe(0);
    expect(stdout).toContain("ok:");
  });

  it("validate-config on an unknown-key config exits 2 with a configErrors envelope", async () => {
    const { code, stdout } = await runCli(
      ["validate-config", ".xlinter.yaml", "--format", "json"],
      repo("bad-config"),
    );
    expect(code).toBe(2);
    const envelope = JSON.parse(stdout) as {
      schemaVersion: number;
      configErrors: { message: string }[];
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(Array.isArray(envelope.configErrors)).toBe(true);
    expect(envelope.configErrors.length).toBeGreaterThan(0);
  });

  it("resolves a bare preset from the extending config's node_modules", async () => {
    const dir = await createPresetFixture({ exports: { "./xlinter.yaml": "./xlinter.yaml" } });
    const { code, stdout, stderr } = await runCli(["--config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("PASS:");
  });

  it("resolves an import-only preset from a path containing spaces", async () => {
    const dir = await createPresetFixture({
      exports: { "./xlinter.yaml": { import: "./xlinter.yaml" } },
      prefix: "xlinter preset ",
    });
    const { code, stdout, stderr } = await runCli(["validate-config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("ok:");
  });

  it("reports a missing preset export as a config error", async () => {
    const dir = await createPresetFixture({ exports: { "./other.yaml": "./xlinter.yaml" } });
    const { code, stderr } = await runCli(["validate-config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(2);
    expect(stderr).toContain(
      'cannot resolve extends "@acme/preset" — a preset package must export "./xlinter.yaml"',
    );
    expect(stderr).toContain("Package subpath");
    expect(stderr).toContain(path.join(dir, "config", ".xlinter.yaml"));
  });

  it("reports an exported preset file that does not exist as a config error", async () => {
    const dir = await createPresetFixture({ exports: { "./xlinter.yaml": "./missing.yaml" } });
    const { code, stderr } = await runCli(["validate-config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(2);
    expect(stderr).toContain('cannot resolve extends "@acme/preset"');
    expect(stderr).toContain("Cannot find module");
    expect(stderr).toContain(path.join(dir, "config", ".xlinter.yaml"));
  });

  it("selects the import branch of a conditional preset export", async () => {
    const dir = await createPresetFixture({
      exports: {
        "./xlinter.yaml": {
          require: "./require.yaml",
          import: "./xlinter.yaml",
          default: "./default.yaml",
        },
      },
      files: { "require.yaml": PRESET_POISON, "default.yaml": PRESET_POISON },
    });
    const { code, stdout, stderr } = await runCli(["validate-config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("(0 rule instance(s))");
  });

  it("does not consult Node --conditions for a preset export", async () => {
    const dir = await createPresetFixture({
      exports: {
        "./xlinter.yaml": { "xlinter-test": "./conditional.yaml", default: "./xlinter.yaml" },
      },
      files: { "conditional.yaml": PRESET_POISON },
    });
    const { code, stdout, stderr } = await runCli(
      ["validate-config", "config/.xlinter.yaml"],
      dir,
      ["--conditions=xlinter-test"],
    );
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("(0 rule instance(s))");
  });

  it("selects a preset variant through a subpath export", async () => {
    const dir = await createPresetFixture({
      exports: { "./xlinter.yaml": "./xlinter.yaml", "./strict/xlinter.yaml": "./strict.yaml" },
      files: { "strict.yaml": PRESET_ONE_RULE },
      extend: "@acme/preset/strict",
    });
    const { code, stdout, stderr } = await runCli(["validate-config", "config/.xlinter.yaml"], dir);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("(1 rule instance(s))");
  });

  it("rules --format json exits 0 and lists the 9 builtin rule types", async () => {
    const { code, stdout } = await runCli(["rules", "--format", "json"], projectRoot);
    expect(code).toBe(0);
    const envelope = JSON.parse(stdout) as {
      schemaVersion: number;
      ruleTypes: { type: string }[];
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.ruleTypes).toHaveLength(9);
    expect(envelope.ruleTypes.map((r) => r.type).sort()).toEqual([
      "cross-file",
      "file-name",
      "file-pairing",
      "first-heading",
      "forbidden-tokens",
      "index-completeness",
      "node-table",
      "nodes",
      "text",
    ]);
  });

  // The docs pages are authored separately; tolerate their absence at run time.
  const fileNameDocs = path.join(projectRoot, "docs", "rules", "file-name.md");
  it.runIf(existsSync(fileNameDocs))(
    "explain file-name exits 0 and prints the doc page",
    async () => {
      const { code, stdout } = await runCli(["explain", "file-name"], projectRoot);
      expect(code).toBe(0);
      expect(stdout.trim().length).toBeGreaterThan(0);
    },
  );
});
