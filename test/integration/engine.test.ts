import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintProject } from "../../src/index.js";

const reposDir = fileURLToPath(new URL("./repos/", import.meta.url));
const configOf = (repo: string): string => path.join(reposDir, repo, ".xlinter.yaml");

describe("lintProject end-to-end", () => {
  it("basic repo: envelope shape, violation finding, rollups, failed", async () => {
    const result = await lintProject({ configFile: configOf("basic") });

    // JSON-envelope shape.
    expect(result.schemaVersion).toBe(1);
    expect(Array.isArray(result.findings)).toBe(true);
    expect(Array.isArray(result.notes)).toBe(true);
    expect(Array.isArray(result.instances)).toBe(true);
    expect(result.summary).toMatchObject({ instances: 3 });
    expect(result.failed).toBe(true);

    // The deliberate file-name violation.
    const violation = result.findings.find((f) => f.ruleId === "local/doc-names");
    expect(violation).toBeDefined();
    expect(violation).toMatchObject({
      ruleId: "local/doc-names",
      ruleType: "file-name",
      kind: "mismatch",
      severity: "error",
    });
    expect(violation?.locator.file).toBe("docs/Bad_Name.md");
    expect(violation?.remediation).toBeTruthy();

    // Instance rollups present, one per instance.
    const byId = new Map(result.instances.map((i) => [i.ruleId, i]));
    expect(byId.get("local/doc-names")).toMatchObject({
      ruleType: "file-name",
      outcome: "error",
      findingCount: 1,
    });
    expect(byId.get("local/app-config")).toMatchObject({ outcome: "pass", findingCount: 0 });
    expect(byId.get("local/broken-yaml")).toMatchObject({ outcome: "error" });
  });

  it("basic repo: malformed yaml surfaces as a parse-error finding", async () => {
    const result = await lintProject({ configFile: configOf("basic") });
    const parseError = result.findings.find((f) => f.kind === "parse-error");
    expect(parseError).toBeDefined();
    expect(parseError).toMatchObject({
      ruleId: "local/broken-yaml",
      ruleType: "nodes",
      severity: "error",
      kind: "parse-error",
    });
    expect(parseError?.locator.file).toBe("broken.yaml");
    expect(parseError?.message).toContain("cannot parse target");
  });

  it("clean repo: failed false, outcomes pass and na", async () => {
    const result = await lintProject({ configFile: configOf("clean") });
    expect(result.schemaVersion).toBe(1);
    expect(result.failed).toBe(false);
    expect(result.findings).toHaveLength(0);

    const byId = new Map(result.instances.map((i) => [i.ruleId, i]));
    expect(byId.get("local/doc-names")?.outcome).toBe("pass");
    expect(byId.get("local/never-matches")?.outcome).toBe("na");
    for (const inst of result.instances) {
      expect(["pass", "na"]).toContain(inst.outcome);
    }
  });

  it("extends chain: child layer overrides severity to warn via full-ID reference", async () => {
    const result = await lintProject({ configFile: configOf("extends-chain") });
    const finding = result.findings.find((f) => f.ruleId === "local/doc-names");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warn");
    expect(finding?.kind).toBe("mismatch");
    // failOn defaults to "error": a warn finding must not fail the run.
    expect(result.failed).toBe(false);
  });

  it("extends chain: failOn warn makes the warn finding fail the run", async () => {
    const result = await lintProject({
      configFile: configOf("extends-chain"),
      failOn: "warn",
    });
    expect(result.findings.some((f) => f.severity === "warn")).toBe(true);
    expect(result.failed).toBe(true);
  });

  it("plugin rule: qualified type id, instance ruleId, finding surfaces", async () => {
    const result = await lintProject({ configFile: configOf("plugin-rule") });
    const finding = result.findings.find((f) => f.message === "plugin ran");
    expect(finding).toBeDefined();
    expect(finding).toMatchObject({
      ruleId: "local/always",
      ruleType: "./rules/pack.js:always-fails",
      kind: "other",
      severity: "error",
    });
    expect(result.failed).toBe(true);

    const rollup = result.instances.find((i) => i.ruleId === "local/always");
    expect(rollup).toMatchObject({
      ruleType: "./rules/pack.js:always-fails",
      outcome: "error",
      findingCount: 1,
    });
  });

  it("exemptions: absence finding suppressed, run passes, note mentions exempted", async () => {
    const result = await lintProject({ configFile: configOf("exemptions") });
    expect(result.failed).toBe(false);
    expect(result.findings).toHaveLength(0);
    const note = result.notes.find((n) => n.message.includes("exempted"));
    expect(note).toBeDefined();
    expect(note?.ruleId).toBe("local/pairing");
    expect(result.instances.find((i) => i.ruleId === "local/pairing")?.outcome).toBe("pass");
  });

  it("stale exemption: audit error when the entry suppressed nothing", async () => {
    const result = await lintProject({ configFile: configOf("exemptions-stale") });
    expect(result.failed).toBe(true);
    const audit = result.findings.find((f) => f.message.includes("suppressed nothing"));
    expect(audit).toBeDefined();
    expect(audit).toMatchObject({
      ruleId: "local/pairing",
      ruleType: "exemptions",
      severity: "error",
      kind: "other",
    });
    expect(audit?.locator.file).toBe("AGENTS.md");
  });
});
