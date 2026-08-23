import { z } from "zod";
import type { DocNode } from "../../structured/doc.js";
import type { Locator, ReportInput } from "../../rule/types.js";
import { regexString, selectorString } from "../../selector/schema.js";

/**
 * The shared assertion vocabulary. `nodes` assertions, `node-table` common
 * assertions, and `node-table` row cells all speak this language, so a value
 * check learned once works everywhere.
 */

export type Reporter = (finding: ReportInput) => void;

/** Checks applicable to one extracted string (scan.each / scan.first). */
export const scalarChecks = z.strictObject({
  eq: z.string().optional(),
  regex: regexString.optional(),
  enum: z.array(z.string()).optional(),
  contains: z.string().optional(),
  notContains: z.string().optional(),
});
export type ScalarChecks = z.infer<typeof scalarChecks>;

export const scanSchema = z.strictObject({
  /** Applied globally over the string value of every selected node. */
  extract: regexString,
  /** Capture group of each match to keep (0 = whole match). */
  group: z.number().int().min(0).default(0),
  /** Split each extraction on this delimiter and trim the pieces. */
  split: z.string().min(1).optional(),
  /** Every extraction must satisfy these checks. */
  each: scalarChecks.optional(),
  /** The FIRST extraction must satisfy these checks. */
  first: scalarChecks.optional(),
  /** The deduplicated set of all extractions must equal exactly this set. */
  setEq: z.array(z.string()).optional(),
  /** Minimum extraction count; defaults to 1 when each/first present unless allowEmpty. */
  minCount: z.number().int().min(0).optional(),
  allowEmpty: z.boolean().default(false),
});

export const valueChecks = z.strictObject({
  required: z.boolean().optional(),
  absent: z.boolean().optional(),
  eq: z.unknown().optional(),
  regex: regexString.optional(),
  enum: z.array(z.unknown()).optional(),
  contains: z.string().optional(),
  notContains: z.string().optional(),
  /** Forbidden when the regex matches the value (kind: forbidden). */
  notMatch: regexString.optional(),
  /** The substring must occur exactly `eq` times (non-overlapping). */
  containsCount: z
    .strictObject({ substring: z.string().min(1), eq: z.number().int().min(0) })
    .optional(),
  scan: scanSchema.optional(),
});
export type ValueChecks = z.infer<typeof valueChecks>;

/** A value check bound to a node-relative selector. */
export const assertion = valueChecks.extend({ path: selectorString });
export type Assertion = z.infer<typeof assertion>;

export function render(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Run one path-bound assertion re-rooted at `node`. Handles required/absent,
 * then delegates the value checks. `nodeId` propagates into every locator.
 */
export function runAssertion(
  report: Reporter,
  file: string,
  node: DocNode,
  a: Assertion,
  nodeId?: string,
): void {
  const values = node.select(a.path);
  const at = withIdentity(file, nodeId);

  if (a.required === true && values.length === 0) {
    report({
      kind: "absence",
      message: `required value ${a.path} is missing`,
      locator: at(node.locator),
      expected: a.path,
      found: "missing",
    });
    return;
  }
  if (a.absent === true && values.length > 0) {
    for (const v of values) {
      report({
        kind: "forbidden",
        message: `forbidden value ${a.path} is present`,
        locator: at(v.locator),
        expected: "absent",
        found: render(v.value),
      });
    }
    return;
  }
  runValueChecks(report, file, a.path, values, a, node.locator, nodeId);
}

/**
 * Run value checks against already-resolved nodes (`label` names what they
 * are — a selector or a column name). `fallback` locates findings when the
 * value list is empty (scan minCount).
 */
export function runValueChecks(
  report: Reporter,
  file: string,
  label: string,
  values: readonly DocNode[],
  checks: ValueChecks,
  fallback: Locator,
  nodeId?: string,
): void {
  const at = withIdentity(file, nodeId);
  const prefix = nodeId !== undefined ? `row ${JSON.stringify(nodeId)}: ` : "";

  for (const v of values) {
    const value = v.value;
    if (checks.eq !== undefined && !deepEqual(value, checks.eq)) {
      report({
        kind: "mismatch",
        message: `${prefix}${label} has the wrong value`,
        locator: at(v.locator),
        expected: render(checks.eq),
        found: render(value),
      });
    }
    if (checks.regex !== undefined && !new RegExp(checks.regex).test(String(value))) {
      report({
        kind: "mismatch",
        message: `${prefix}${label} does not match /${checks.regex}/`,
        locator: at(v.locator),
        expected: `match /${checks.regex}/`,
        found: render(value),
      });
    }
    if (checks.enum !== undefined && !checks.enum.some((e) => deepEqual(value, e))) {
      report({
        kind: "mismatch",
        message: `${prefix}${label} is not one of the allowed values`,
        locator: at(v.locator),
        expected: checks.enum.map(render).join(" | "),
        found: render(value),
      });
    }
    if (checks.contains !== undefined && !String(value).includes(checks.contains)) {
      report({
        kind: "mismatch",
        message: `${prefix}${label} does not contain the required substring`,
        locator: at(v.locator),
        expected: `contains ${JSON.stringify(checks.contains)}`,
        found: render(value),
      });
    }
    if (checks.notContains !== undefined && String(value).includes(checks.notContains)) {
      report({
        kind: "forbidden",
        message: `${prefix}${label} contains a forbidden substring`,
        locator: at(v.locator),
        expected: `does not contain ${JSON.stringify(checks.notContains)}`,
        found: render(value),
      });
    }
    if (checks.notMatch !== undefined) {
      const m = new RegExp(checks.notMatch).exec(String(value));
      if (m) {
        report({
          kind: "forbidden",
          message: `${prefix}${label} matches forbidden pattern /${checks.notMatch}/`,
          locator: at(v.locator),
          expected: `no match for /${checks.notMatch}/`,
          found: render(m[0]),
        });
      }
    }
    if (checks.containsCount !== undefined) {
      const n = countOccurrences(String(value), checks.containsCount.substring);
      if (n !== checks.containsCount.eq) {
        report({
          kind: "mismatch",
          message: `${prefix}${label} contains ${JSON.stringify(checks.containsCount.substring)} ${n} time(s), expected exactly ${checks.containsCount.eq}`,
          locator: at(v.locator),
          expected: `exactly ${checks.containsCount.eq} occurrence(s)`,
          found: `${n} occurrence(s)`,
        });
      }
    }
  }

  if (checks.scan !== undefined) {
    runScan(report, file, label, values, checks.scan, fallback, nodeId);
  }
}

function runScan(
  report: Reporter,
  file: string,
  label: string,
  values: readonly DocNode[],
  scan: z.infer<typeof scanSchema>,
  fallback: Locator,
  nodeId?: string,
): void {
  const at = withIdentity(file, nodeId);
  const prefix = nodeId !== undefined ? `row ${JSON.stringify(nodeId)}: ` : "";
  const re = new RegExp(scan.extract, "g");
  const extractions: { text: string; locator: Locator }[] = [];
  for (const v of values) {
    const s = String(v.value);
    for (const m of s.matchAll(re)) {
      const captured = m[scan.group];
      if (captured === undefined) continue;
      const pieces = scan.split !== undefined
        ? captured.split(scan.split).map((p) => p.trim()).filter((p) => p !== "")
        : [captured];
      for (const piece of pieces) {
        extractions.push({ text: piece, locator: v.locator });
      }
    }
  }
  const anchor = values[0]?.locator ?? fallback;
  const minCount =
    scan.minCount ??
    ((scan.each !== undefined || scan.first !== undefined) && !scan.allowEmpty ? 1 : 0);

  if (extractions.length < minCount) {
    report({
      kind: "absence",
      message: `${prefix}scan /${scan.extract}/ on ${label} matched ${extractions.length} time(s), expected at least ${minCount}`,
      locator: at(anchor),
      expected: `>= ${minCount} match(es)`,
      found: `${extractions.length}`,
    });
  }

  if (scan.first !== undefined && extractions.length > 0) {
    const first = extractions[0];
    if (first !== undefined) {
      runScalarChecks(report, file, `first extraction of ${label}`, first, scan.first, prefix, nodeId);
    }
  }
  if (scan.each !== undefined) {
    for (const e of extractions) {
      runScalarChecks(report, file, `extraction of ${label}`, e, scan.each, prefix, nodeId);
    }
  }
  if (scan.setEq !== undefined) {
    const actual = [...new Set(extractions.map((e) => e.text))].sort();
    const expected = [...new Set(scan.setEq)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      const missing = expected.filter((x) => !actual.includes(x));
      const unexpected = actual.filter((x) => !expected.includes(x));
      report({
        kind: "mismatch",
        message:
          `${prefix}scan set mismatch on ${label} — ` +
          `missing: [${missing.join(", ")}]; unexpected: [${unexpected.join(", ")}]`,
        locator: at(anchor),
        expected: `{${expected.join(", ")}}`,
        found: `{${actual.join(", ")}}`,
      });
    }
  }
}

function runScalarChecks(
  report: Reporter,
  file: string,
  label: string,
  extraction: { text: string; locator: Locator },
  checks: ScalarChecks,
  prefix: string,
  nodeId?: string,
): void {
  const at = withIdentity(file, nodeId);
  const value = extraction.text;
  if (checks.eq !== undefined && value !== checks.eq) {
    report({
      kind: "mismatch",
      message: `${prefix}${label} has the wrong value`,
      locator: at(extraction.locator),
      expected: render(checks.eq),
      found: render(value),
    });
  }
  if (checks.regex !== undefined && !new RegExp(checks.regex).test(value)) {
    report({
      kind: "mismatch",
      message: `${prefix}${label} does not match /${checks.regex}/`,
      locator: at(extraction.locator),
      expected: `match /${checks.regex}/`,
      found: render(value),
    });
  }
  if (checks.enum !== undefined && !checks.enum.includes(value)) {
    report({
      kind: "mismatch",
      message: `${prefix}${label} is not one of the allowed values`,
      locator: at(extraction.locator),
      expected: checks.enum.map(render).join(" | "),
      found: render(value),
    });
  }
  if (checks.contains !== undefined && !value.includes(checks.contains)) {
    report({
      kind: "mismatch",
      message: `${prefix}${label} does not contain the required substring`,
      locator: at(extraction.locator),
      expected: `contains ${JSON.stringify(checks.contains)}`,
      found: render(value),
    });
  }
  if (checks.notContains !== undefined && value.includes(checks.notContains)) {
    report({
      kind: "forbidden",
      message: `${prefix}${label} contains a forbidden substring`,
      locator: at(extraction.locator),
      expected: `does not contain ${JSON.stringify(checks.notContains)}`,
      found: render(value),
    });
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

function withIdentity(file: string, nodeId?: string): (loc: Locator) => Locator {
  return (loc) => ({
    ...loc,
    file,
    ...(nodeId !== undefined ? { nodeId } : {}),
  });
}
