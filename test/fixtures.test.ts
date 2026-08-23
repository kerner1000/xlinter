import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { builtinRules, type RuleDescriptor } from "../src/index.js";
import { listFixtureCases, runFixtureCase } from "../src/testing/harness.js";

/**
 * Fixture-first, mechanically enforced: every builtin rule type must ship at
 * least one valid and one invalid fixture case under
 * src/rules/<type>/fixtures/{valid,invalid}/<case>/, and every case must run
 * clean through the published harness (over-reporting fails too).
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fixturesDirFor(type: string): string {
  return path.join(repoRoot, "src", "rules", type, "fixtures");
}

describe("fixture-first meta-test", () => {
  for (const rule of builtinRules) {
    it(`${rule.type} ships >=1 valid and >=1 invalid fixture case`, async () => {
      const dir = fixturesDirFor(rule.type);
      expect(existsSync(dir), `missing fixtures directory: ${dir}`).toBe(true);
      const cases = await listFixtureCases(dir);
      expect(
        cases.valid.length,
        `rule type "${rule.type}" has no valid fixture cases under ${dir}/valid`,
      ).toBeGreaterThanOrEqual(1);
      expect(
        cases.invalid.length,
        `rule type "${rule.type}" has no invalid fixture cases under ${dir}/invalid`,
      ).toBeGreaterThanOrEqual(1);
    });
  }
});

for (const rule of builtinRules) {
  const cases = await listFixtureCases(fixturesDirFor(rule.type));
  const all = [
    ...cases.valid.map((dir) => ({ dir, kind: "valid" })),
    ...cases.invalid.map((dir) => ({ dir, kind: "invalid" })),
  ];
  describe(`${rule.type} fixtures`, () => {
    for (const c of all) {
      it(`${c.kind}/${path.basename(c.dir)}`, async () => {
        const result = await runFixtureCase(rule as RuleDescriptor<unknown>, c.dir);
        expect(
          result.problems,
          `fixture case ${c.dir} failed:\n${result.problems.map((p) => `  - ${p}`).join("\n")}`,
        ).toEqual([]);
      });
    }
  });
}
