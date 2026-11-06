import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import type { RunResult } from "../../src/index.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = path.join(projectRoot, "dist", "cli", "main.js");
const reposDir = fileURLToPath(new URL("./repos/", import.meta.url));
const repo = (name: string): string => path.join(reposDir, name);
const fixtureDirs: string[] = [];

afterAll(async () => {
  for (const dir of fixtureDirs) await rm(dir, { recursive: true, force: true });
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
  fixtureDirs.push(dir);
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

describe("invalid command-line arguments through the built CLI", () => {
  const cases: [label: string, args: string[], option: string][] = [
    ["an unknown long option", [".", "--output", "x.json"], "--output"],
    ["an unknown short option", ["-x"], "-x"],
    ["an unknown option on rules", ["rules", "--bogus"], "--bogus"],
    ["an unknown option on explain", ["explain", "file-name", "--bogus"], "--bogus"],
    ["an unknown option on validate-config", ["validate-config", "--bogus"], "--bogus"],
    ["a missing option value", ["--format"], "--format"],
    ["a value on a boolean option", ["--list-targets=yes"], "--list-targets"],
    // Node words this one over three lines.
    ["an option where a value belongs", ["--config", "--rules"], "--config"],
  ];

  for (const [label, args, option] of cases) {
    it(`${label} exits 2 with one line on stderr`, async () => {
      const { code, stdout, stderr } = await runCli(args, repo("clean"));
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^config error: [^\n]+\n$/);
      expect(stderr).toContain(option);
    });
  }

  it("--format json reports an unknown option in the configErrors envelope", async () => {
    const { code, stdout, stderr } = await runCli(
      ["--format", "json", "--output", "x.json"],
      repo("clean"),
    );
    expect(code).toBe(2);
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout) as {
      schemaVersion: number;
      configErrors: { message: string }[];
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.configErrors).toEqual([{ message: expect.stringContaining("--output") }]);
  });
});

/** Exercise policy findings through the real CLI and its exit-code contract. */
async function lintRuleFixture(rule: Record<string, unknown>, files: Record<string, string>) {
  const dir = await mkdtemp(path.join(tmpdir(), "xlinter-rule-"));
  fixtureDirs.push(dir);
  await writeFile(path.join(dir, ".xlinter.yaml"), JSON.stringify({
    version: 1,
    discovery: "walk",
    rules: { probe: { targets: { include: Object.keys(files) }, ...rule } },
  }));
  for (const [name, text] of Object.entries(files)) {
    await writeFile(path.join(dir, name), text);
  }
  const result = await runCli(["--format", "json"], dir);
  return { ...result, envelope: JSON.parse(result.stdout) as RunResult };
}

describe("review regressions through the built CLI", () => {
  for (const type of ["nodes", "node-table"]) {
    for (const severity of ["warn", "note"]) {
      it(`${type}: malformed embedded YAML is an error at severity ${severity} and later targets still run`, async () => {
        const checks = type === "nodes"
          ? { select: "$", assert: [{ path: "$.port", eq: 80, required: true }] }
          : { select: "$.services[*]", key: "$.name", rows: { web: { port: { eq: 80 } } } };
        const later = type === "nodes"
          ? "values: |\n  port: 81\n"
          : "values: |\n  services:\n    - name: web\n      port: 81\n";
        const { code, stderr, envelope } = await lintRuleFixture({
          type, severity, parse: "yaml", decode: { path: "$.values", as: "yaml" }, ...checks,
        }, { "a-broken.yaml": "values: |\n  port: [bad\n", "b-later.yaml": later });
        expect(stderr).toBe("");
        expect(code).toBe(1);
        expect(envelope.failed).toBe(true);
        expect(envelope.findings).toHaveLength(2);
        expect(envelope.findings).toEqual(expect.arrayContaining([
          expect.objectContaining({
            kind: "parse-error", severity: "error", ruleType: type,
            message: expect.stringContaining("cannot parse embedded yaml at $.values"),
            remediation: expect.stringContaining("syntax"),
            locator: expect.objectContaining({ file: "a-broken.yaml" }),
          }),
          expect.objectContaining({
            kind: "mismatch", severity, ruleType: type,
            message: expect.stringContaining("has the wrong value"),
            locator: expect.objectContaining({ file: "b-later.yaml", embeddedIn: "$.values" }),
          }),
        ]));
      });
    }
  }

  for (const [label, eol] of [["LF", "\n"], ["CRLF", "\r\n"]] as const) {
    it(`${label}: requireMatch accepts a full matching line and rejects a near miss`, async () => {
      const rule = { type: "text", requireMatch: ["^enabled=true$"] };
      const present = await lintRuleFixture(rule, { "settings.txt": ["intro", "enabled=true", "tail", ""].join(eol) });
      expect(present.code).toBe(0);
      expect(present.envelope.findings).toEqual([]);
      const missing = await lintRuleFixture(rule, { "settings.txt": `enabled=true-extra${eol}` });
      expect(missing.code).toBe(1);
      expect(missing.envelope.findings).toMatchObject([{
        kind: "absence", message: "no line matches required pattern /^enabled=true$/",
      }]);
    });

    it(`${label}: forbidMatch rejects a full matching line and accepts a near miss`, async () => {
      const rule = { type: "text", forbidMatch: ["^enabled=true$"] };
      const forbidden = await lintRuleFixture(rule, { "settings.txt": ["intro", "enabled=true", "tail", ""].join(eol) });
      expect(forbidden.code).toBe(1);
      expect(forbidden.envelope.findings).toMatchObject([{
        kind: "forbidden", locator: { file: "settings.txt", line: 2 },
        message: "line matches forbidden pattern /^enabled=true$/", found: "enabled=true",
      }]);
      const allowed = await lintRuleFixture(rule, { "settings.txt": `enabled=true-extra${eol}` });
      expect(allowed.code).toBe(0);
      expect(allowed.envelope.findings).toEqual([]);
    });
  }
});

describe("lint paths through the built CLI", () => {
  const missingPaths: [label: string, arg: string][] = [
    ["a path that does not exist", "no-such-path"],
    ["a missing file in an existing directory", "docs/no-such-file.md"],
    ["a path below a file", "docs/alpha.md/below"],
    ["a glob, which is taken as a literal path", "docs/*.md"],
  ];

  for (const [label, arg] of missingPaths) {
    it(`${label} exits 2 with one line on stderr`, async () => {
      const { code, stdout, stderr } = await runCli([arg], repo("clean"));
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^config error: lint path not found: [^\n]+\n$/);
      expect(stderr).toContain(arg);
    });
  }

  // On this repository's config, index-completeness reports that its index file is not among the
  // narrowed targets, so this run used to exit 1 with a finding unrelated to the typo.
  for (const [label, cwd] of [
    ["a config whose rules can all be n/a", repo("clean")],
    ["this repository's own config", projectRoot],
  ] as const) {
    it(`a mistyped subcommand on ${label} exits 2 and names the argument`, async () => {
      const { code, stdout, stderr } = await runCli(["valdiate-config"], cwd);
      expect(code).toBe(2);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^config error: lint path not found: valdiate-config \([^\n]+\)\n$/);
    });
  }

  it("reports a missing path ahead of a broken config", async () => {
    const { code, stderr } = await runCli(["no-such-path"], repo("bad-config"));
    expect(code).toBe(2);
    expect(stderr).toMatch(/^config error: lint path not found: no-such-path \([^\n]+\)\n$/);
  });

  it("reports every missing path and does not lint the ones that exist", async () => {
    const { code, stdout, stderr } = await runCli(["no-such-a", "docs", "no-such-b"], repo("clean"));
    expect(code).toBe(2);
    expect(stdout).toBe("");
    const lines = stderr.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("lint path not found: no-such-a");
    expect(lines[1]).toContain("lint path not found: no-such-b");
  });

  it("--format json reports a missing path in the configErrors envelope", async () => {
    const { code, stdout, stderr } = await runCli(["no-such-path", "--format", "json"], repo("clean"));
    expect(code).toBe(2);
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout) as {
      schemaVersion: number;
      configErrors: { message: string }[];
    };
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.configErrors).toEqual([
      { message: expect.stringContaining("lint path not found: no-such-path") },
    ]);
  });

  it("--list-targets reports a missing path instead of listing targets", async () => {
    const { code, stdout, stderr } = await runCli(["no-such-path", "--list-targets"], repo("clean"));
    expect(code).toBe(2);
    expect(stdout).toBe("");
    expect(stderr).toContain("lint path not found: no-such-path");
  });

  it("--list-targets accepts a path that exists", async () => {
    const { code, stdout } = await runCli(["docs", "--list-targets"], repo("clean"));
    expect(code).toBe(0);
    expect(stdout).toContain("docs/alpha.md");
  });

  it("a path that exists but matches no target stays a normal n/a run", async () => {
    // repos/basic exists, but it is outside the root of repos/clean.
    const human = await runCli(["../basic"], repo("clean"));
    expect(human.code).toBe(0);
    expect(human.stderr).toBe("");
    expect(human.stdout).toContain("PASS: 2 rule instance(s) — 0 pass, 2 n/a");

    const json = await runCli(["../basic", "--format", "json"], repo("clean"));
    expect(json.code).toBe(0);
    const envelope = JSON.parse(json.stdout) as RunResult;
    expect(envelope.instances).toHaveLength(2);
    for (const instance of envelope.instances) {
      expect(instance).toMatchObject({ outcome: "na", targetsMatched: 0 });
    }
  });

  for (const [label, arg, matched] of [
    ["an existing directory", "docs", 2],
    ["an existing file", "docs/alpha.md", 1],
  ] as const) {
    it(`${label} still narrows the run`, async () => {
      const { code, stdout } = await runCli([arg, "--format", "json"], repo("clean"));
      expect(code).toBe(0);
      const envelope = JSON.parse(stdout) as RunResult;
      expect(envelope.instances.find((i) => i.ruleId === "local/doc-names")).toMatchObject({
        outcome: "pass",
        targetsMatched: matched,
      });
    });
  }

  it("a dangling symlink exists: it is a target, not a missing path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "xlinter-paths-"));
    fixtureDirs.push(dir);
    await writeFile(path.join(dir, ".xlinter.yaml"), JSON.stringify({
      version: 1,
      discovery: "walk",
      rules: { probe: { type: "file-name", targets: { include: ["dangling"] }, pattern: ".*" } },
    }));
    await symlink("no-such-target", path.join(dir, "dangling"));
    const { code, stdout, stderr } = await runCli(["dangling", "--format", "json"], dir);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    const envelope = JSON.parse(stdout) as RunResult;
    expect(envelope.instances).toMatchObject([{ targetsMatched: 1 }]);
  });
});
