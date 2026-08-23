import { describe, expect, it } from "vitest";
import { deriveOutcome, failsRun, worstOutcome } from "../../src/report/lattice.js";
import type { Finding, RuleOutcome, Severity } from "../../src/rule/types.js";

function finding(severity: Severity): Finding {
  return {
    ruleId: "ns/rule",
    ruleType: "file-name",
    severity,
    kind: "mismatch",
    message: `a ${severity} finding`,
    locator: { file: "a.md" },
    remediation: "fix it",
  };
}

const noFlags = {};

describe("deriveOutcome", () => {
  it("returns pass with no findings and no flags", () => {
    expect(deriveOutcome([], noFlags)).toBe("pass");
  });

  it("error findings beat warn findings", () => {
    expect(deriveOutcome([finding("warn"), finding("error")], noFlags)).toBe("error");
  });

  it("a warn finding alone yields warn", () => {
    expect(deriveOutcome([finding("warn")], noFlags)).toBe("warn");
  });

  it("note findings never fail: notes alone yield pass", () => {
    expect(deriveOutcome([finding("note")], noFlags)).toBe("pass");
  });

  it("the skipped flag alone yields skipped", () => {
    expect(deriveOutcome([], { skipped: "network down" })).toBe("skipped");
  });

  it("the notApplicable flag alone yields na", () => {
    expect(deriveOutcome([], { notApplicable: "not a repo" })).toBe("na");
  });

  it("skipped beats na when both flags are set", () => {
    expect(deriveOutcome([], { skipped: "s", notApplicable: "n" })).toBe("skipped");
  });

  it("findings beat the skipped flag — observations already made are kept", () => {
    expect(deriveOutcome([finding("error")], { skipped: "gave up later" })).toBe("error");
    expect(deriveOutcome([finding("warn")], { skipped: "gave up later" })).toBe("warn");
  });

  it("findings beat the notApplicable flag", () => {
    expect(deriveOutcome([finding("error")], { notApplicable: "n" })).toBe("error");
  });
});

describe("worstOutcome", () => {
  it("returns pass for an empty list", () => {
    expect(worstOutcome([])).toBe("pass");
  });

  it.each<[RuleOutcome[], RuleOutcome]>([
    [["pass", "na"], "na"],
    [["na", "skipped"], "skipped"],
    [["skipped", "warn"], "warn"],
    [["warn", "error"], "error"],
    [["pass", "pass"], "pass"],
  ])("worst of %j is %s", (outcomes, expected) => {
    expect(worstOutcome(outcomes)).toBe(expected);
  });

  it("is order-independent", () => {
    expect(worstOutcome(["error", "pass", "na"])).toBe("error");
    expect(worstOutcome(["na", "pass", "error"])).toBe("error");
  });
});

describe("failsRun", () => {
  it("an error finding fails under failOn error", () => {
    expect(failsRun([finding("error")], "error")).toBe(true);
  });

  it("a warn finding does not fail under failOn error", () => {
    expect(failsRun([finding("warn")], "error")).toBe(false);
  });

  it("a warn finding fails under failOn warn", () => {
    expect(failsRun([finding("warn")], "warn")).toBe(true);
  });

  it("a note finding never fails, even under failOn warn", () => {
    expect(failsRun([finding("note")], "warn")).toBe(false);
  });

  it("no findings never fails", () => {
    expect(failsRun([], "warn")).toBe(false);
  });
});
