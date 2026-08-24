import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const cliPath = path.join(projectRoot, "dist", "cli", "main.js");
const reposDir = fileURLToPath(new URL("./repos/", import.meta.url));
const repo = (name: string): string => path.join(reposDir, name);

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Spawn the built CLI; a non-zero exit is a result, never a test crash. */
function runCli(args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
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
