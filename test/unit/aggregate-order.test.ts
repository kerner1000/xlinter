import { describe, expect, it } from "vitest";
import { aggregate, type InvocationResult } from "../../src/engine/aggregate.js";
import type { RawExemption } from "../../src/config/types.js";
import type { Finding, FindingKind } from "../../src/rule/types.js";

function mkFinding(
  ruleId: string,
  kind: FindingKind,
  file: string,
  extra: Partial<Finding> = {},
): Finding {
  return {
    ruleId,
    ruleType: "file-name",
    severity: "error",
    kind,
    message: `${kind} finding on ${file}`,
    locator: { file },
    remediation: "fix it",
    ...extra,
  };
}

function mkInv(
  ruleId: string,
  findings: Finding[],
  extra: Partial<InvocationResult> = {},
): InvocationResult {
  return {
    ruleId,
    ruleType: "file-name",
    findings,
    notes: [],
    targetsMatched: 1,
    onEmpty: "na",
    remediation: "fix it",
    ...extra,
  };
}

function exemption(rule: string, file: string, extra: Partial<RawExemption> = {}): RawExemption {
  return { rule, file, reason: "legacy debt", ...extra };
}

describe("aggregate — exemption filtering", () => {
  it("suppresses an absence finding and surfaces a NOTE naming the reason", () => {
    const inv = mkInv("ns/r", [mkFinding("ns/r", "absence", "docs/a.md")]);
    const result = aggregate([inv], [exemption("ns/r", "docs/a.md", { issue: "#42" })], "error");

    expect(result.findings).toHaveLength(0);
    expect(result.failed).toBe(false);
    expect(result.instances[0]?.outcome).toBe("pass");

    const note = result.notes.find((n) => n.message.startsWith("exempted:"));
    expect(note).toBeDefined();
    expect(note?.message).toContain("legacy debt");
    expect(note?.message).toContain("#42");
    expect(note?.ruleId).toBe("ns/r");
    expect(note?.locator?.file).toBe("docs/a.md");
  });

  it("does NOT suppress a mismatch finding; the audit reports present-but-wrong", () => {
    const inv = mkInv("ns/r", [mkFinding("ns/r", "mismatch", "docs/a.md")]);
    const result = aggregate([inv], [exemption("ns/r", "docs/a.md")], "error");

    // The mismatch survives...
    const mismatch = result.findings.find((f) => f.kind === "mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.locator.file).toBe("docs/a.md");

    // ...and the zero-effect exemption entry becomes its own error.
    const audit = result.findings.find((f) => f.ruleType === "exemptions");
    expect(audit).toBeDefined();
    expect(audit?.severity).toBe("error");
    expect(audit?.message).toContain("present-but-wrong");
    expect(audit?.message).toContain("exemptions suppress absence only");

    expect(result.findings).toHaveLength(2);
    expect(result.failed).toBe(true);
  });
});

describe("aggregate — exemption audit", () => {
  it("errors on a stale entry whose rule never ran", () => {
    const unrelated = mkInv("ns/other", []);
    const result = aggregate([unrelated], [exemption("ns/ghost", "docs/a.md")], "error");

    expect(result.findings).toHaveLength(1);
    const audit = result.findings[0];
    expect(audit?.ruleType).toBe("exemptions");
    expect(audit?.severity).toBe("error");
    expect(audit?.message).toContain("stale exemption");
    expect(audit?.message).toContain('"ns/ghost"');
    expect(result.failed).toBe(true);
    // The unrelated instance itself still passes.
    expect(result.instances.find((i) => i.ruleId === "ns/other")?.outcome).toBe("pass");
  });

  it("errors on an entry whose target passes (suppressed nothing)", () => {
    const inv = mkInv("ns/r", [], { targetsMatched: 3 });
    const result = aggregate([inv], [exemption("ns/r", "docs/a.md")], "error");

    expect(result.findings).toHaveLength(1);
    const audit = result.findings[0];
    expect(audit?.message).toContain("suppressed nothing");
    expect(audit?.message).toContain("the list may only shrink");
    expect(result.failed).toBe(true);
  });

  it("ORDERING CONTRACT: empty input (0 targets, onEmpty na) never masks a stale entry", () => {
    const inv = mkInv("ns/r", [], { targetsMatched: 0, onEmpty: "na" });
    const result = aggregate([inv], [exemption("ns/r", "docs/a.md")], "error");

    // The empty instance itself is na...
    const rollup = result.instances.find((i) => i.ruleId === "ns/r");
    expect(rollup?.outcome).toBe("na");
    expect(rollup?.reason).toBe("no targets matched");

    // ...but its zero-effect exemption is still audited as an error.
    const audit = result.findings.find((f) => f.ruleType === "exemptions");
    expect(audit).toBeDefined();
    expect(audit?.severity).toBe("error");
    expect(audit?.message).toContain("suppressed nothing");
    expect(result.failed).toBe(true);
  });
});

describe("aggregate — onEmpty guard", () => {
  it("onEmpty warn produces a warn absence guard finding and a warn outcome", () => {
    const inv = mkInv("ns/r", [], { targetsMatched: 0, onEmpty: "warn" });
    const result = aggregate([inv], [], "error");

    expect(result.findings).toHaveLength(1);
    const guard = result.findings[0];
    expect(guard?.severity).toBe("warn");
    expect(guard?.kind).toBe("absence");
    expect(guard?.message).toContain("no targets matched this rule instance");
    expect(guard?.locator.file).toBe(".");
    expect(result.instances[0]?.outcome).toBe("warn");
    expect(result.failed).toBe(false); // warn does not fail under failOn error
    expect(aggregate([inv], [], "warn").failed).toBe(true);
  });

  it("onEmpty error produces an error guard finding and fails the run", () => {
    const inv = mkInv("ns/r", [], { targetsMatched: 0, onEmpty: "error" });
    const result = aggregate([inv], [], "error");

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe("error");
    expect(result.findings[0]?.kind).toBe("absence");
    expect(result.instances[0]?.outcome).toBe("error");
    expect(result.failed).toBe(true);
  });

  it("onEmpty na yields outcome na with no guard finding", () => {
    const inv = mkInv("ns/r", [], { targetsMatched: 0, onEmpty: "na" });
    const result = aggregate([inv], [], "error");

    expect(result.findings).toHaveLength(0);
    expect(result.instances[0]?.outcome).toBe("na");
    expect(result.instances[0]?.reason).toBe("no targets matched");
    expect(result.summary.na).toBe(1);
    expect(result.failed).toBe(false);
  });
});

describe("aggregate — finding order", () => {
  it("sorts findings by file, then line (missing line first), then ruleId", () => {
    const invZ = mkInv("ns/z", [
      mkFinding("ns/z", "mismatch", "b.md", { locator: { file: "b.md", line: 2 } }),
      mkFinding("ns/z", "mismatch", "a.md", { locator: { file: "a.md", line: 5 } }),
      mkFinding("ns/z", "mismatch", "a.md", { locator: { file: "a.md" } }),
    ]);
    const invA = mkInv("ns/a", [
      mkFinding("ns/a", "mismatch", "a.md", { locator: { file: "a.md", line: 5 } }),
      mkFinding("ns/a", "mismatch", "a.md", { locator: { file: "a.md", line: 1 } }),
    ]);
    const result = aggregate([invZ, invA], [], "error");

    const order = result.findings.map(
      (f) => `${f.locator.file}:${f.locator.line ?? 0}:${f.ruleId}`,
    );
    expect(order).toEqual([
      "a.md:0:ns/z", // no line sorts as 0, before line 1
      "a.md:1:ns/a",
      "a.md:5:ns/a", // same file+line: ruleId breaks the tie
      "a.md:5:ns/z",
      "b.md:2:ns/z",
    ]);
  });
});
