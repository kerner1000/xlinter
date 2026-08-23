import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { RuleDescriptor } from "../rule/types.js";
import type { ResolvedRuleEntry } from "../config/types.js";
import { realServices } from "../engine/services.js";
import { resolveTargets } from "../engine/targets.js";
import { aggregate, type RunResult } from "../engine/aggregate.js";
import type { ResolvedConfig } from "../config/types.js";

/**
 * Fixture-first harness, exported as `xlinter/testing` so rule packs test
 * their rules exactly like builtins.
 *
 * Layout per rule: fixtures/valid/<case>/ and fixtures/invalid/<case>/, each a
 * miniature file tree plus case.yaml:
 *
 *   options: { ... }              # rule options
 *   include: ["*.md"]             # optional instance scope (default: everything)
 *   expected:
 *     outcome: pass | error | warn | na
 *     findings:                   # invalid cases: EXACT set (over-reporting fails)
 *       - file: bad.md
 *         kind: mismatch
 *         messageIncludes: "does not match"
 */

const caseSchema = z.strictObject({
  options: z.record(z.string(), z.unknown()).default({}),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  expected: z.strictObject({
    outcome: z.enum(["pass", "error", "warn", "na"]).default("pass"),
    findings: z
      .array(
        z.strictObject({
          file: z.string(),
          kind: z.string().optional(),
          line: z.number().optional(),
          messageIncludes: z.string().optional(),
        }),
      )
      .default([]),
  }),
});

export interface FixtureCaseResult {
  name: string;
  dir: string;
  problems: string[];
  result: RunResult;
}

export async function listFixtureCases(fixturesDir: string): Promise<{ valid: string[]; invalid: string[] }> {
  async function list(kind: string): Promise<string[]> {
    const dir = path.join(fixturesDir, kind);
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  }
  return { valid: await list("valid"), invalid: await list("invalid") };
}

/** Run one fixture case; returns human-readable problems (empty = case passes). */
export async function runFixtureCase(
  rule: RuleDescriptor<unknown>,
  caseDir: string,
): Promise<FixtureCaseResult> {
  const name = path.basename(caseDir);
  const raw = parseYaml(await readFile(path.join(caseDir, "case.yaml"), "utf8"));
  const parsed = caseSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      name,
      dir: caseDir,
      problems: parsed.error.issues.map((i) => `case.yaml invalid: ${i.path.join(".")}: ${i.message}`),
      result: emptyResult(),
    };
  }
  const spec = parsed.data;

  const optionsParse = rule.meta.optionsSchema.safeParse(spec.options);
  if (!optionsParse.success) {
    return {
      name,
      dir: caseDir,
      problems: optionsParse.error.issues.map(
        (i) => `options invalid for ${rule.type}: ${i.path.join(".")}: ${i.message}`,
      ),
      result: emptyResult(),
    };
  }

  const result = await runRuleOnDir(rule, caseDir, optionsParse.data, spec.include, spec.exclude);

  const problems: string[] = [];
  const outcome = result.instances[0]?.outcome ?? "pass";
  if (outcome !== spec.expected.outcome) {
    problems.push(
      `expected outcome ${spec.expected.outcome}, got ${outcome}` +
        (result.findings.length
          ? ` — findings: ${result.findings.map((f) => `${f.locator.file}: ${f.message}`).join("; ")}`
          : ""),
    );
  }
  const unmatched = [...result.findings];
  for (const exp of spec.expected.findings) {
    const idx = unmatched.findIndex(
      (f) =>
        f.locator.file === exp.file &&
        (exp.kind === undefined || f.kind === exp.kind) &&
        (exp.line === undefined || f.locator.line === exp.line) &&
        (exp.messageIncludes === undefined || f.message.includes(exp.messageIncludes)),
    );
    if (idx === -1) {
      problems.push(`expected finding not produced: ${JSON.stringify(exp)}`);
    } else {
      unmatched.splice(idx, 1);
    }
  }
  for (const f of unmatched) {
    problems.push(
      `unexpected finding: ${f.locator.file}${f.locator.line ? `:${f.locator.line}` : ""} [${f.kind}] ${f.message}`,
    );
  }
  return { name, dir: caseDir, problems, result };
}

/** Run a single rule instance against a plain directory (no config file needed). */
export async function runRuleOnDir(
  rule: RuleDescriptor<unknown>,
  rootDir: string,
  options: unknown,
  include?: string[],
  exclude?: string[],
): Promise<RunResult> {
  const config: ResolvedConfig = {
    namespace: "fixture",
    roots: [{ path: ".", kind: "repo" }],
    discovery: "walk",
    ignore: ["case.yaml"],
    rules: new Map(),
    exemptions: [],
    adapters: {},
    plugins: [],
    file: path.join(rootDir, ".xlinter.yaml"),
  };
  const { roots, targets } = await resolveTargets(config);
  const entry: ResolvedRuleEntry = {
    id: `fixture/${rule.type.replace(/[^a-z0-9-]/g, "-")}`,
    type: rule.type,
    enabled: true,
    onEmpty: "na",
    params: {},
    definedIn: config.file,
    ...(include !== undefined ? { include } : {}),
    ...(exclude !== undefined ? { exclude } : {}),
  };
  const { runInstanceForTesting } = await import("../engine/engine.js");
  const root = roots[0];
  if (!root) throw new Error("fixture root did not resolve");
  const inv = await runInstanceForTesting(rule, entry, options, root, targets, realServices());
  return aggregate([inv], [], "error");
}

function emptyResult(): RunResult {
  return aggregate([], [], "error");
}
