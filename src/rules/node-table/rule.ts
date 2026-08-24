import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import { selectorString } from "../../selector/schema.js";
import {
  assertion,
  render,
  runAssertion,
  runValueChecks,
  valueChecks,
  type Reporter,
  type ValueChecks,
} from "../shared/asserts.js";
import type { DocNode } from "../../structured/doc.js";

const options = z
  .strictObject({
    parse: z.enum(["yaml", "yaml-multi", "json", "frontmatter"]),
    /** Selector for the row nodes. */
    select: selectorString,
    /** Node-relative selector for a row's identity; must resolve to one scalar. */
    key: selectorString,
    /** Every present key must appear in `rows` (and vice versa — always). */
    closedWorld: z.boolean().default(false),
    /** What zero selected rows means. (Named onNoRows: `onEmpty` is an instance control key.) */
    onNoRows: z.enum(["error", "pass"]).default("error"),
    /** Named sibling sub-selections, resolved per row; must bind exactly one node. */
    columns: z
      .record(
        z.string(),
        z.strictObject({ path: selectorString, required: z.boolean().default(true) }),
      )
      .default({}),
    /** Assertions applied to every row node. */
    common: z.array(assertion).default([]),
    /** Per-key expectations: key value -> field/column name -> value checks. */
    rows: z.record(z.string(), z.record(z.string(), valueChecks)).default({}),
  })
  .superRefine((o, ctx) => {
    if (o.closedWorld && Object.keys(o.rows).length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "closedWorld: true requires a non-empty rows table",
      });
    }
  });

type Options = z.infer<typeof options>;

export const nodeTableRule = defineRule<Options>({
  type: "node-table",
  meta: {
    summary: "Keyed expectation table: values bound to the node that owns the key",
    docs: new URL("../../../docs/rules/node-table.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Fix the named field on the named row — expectations are bound per key; never copy values across rows.",
    optionsSchema: options,
  },
  async check(ctx) {
    const o = ctx.options;
    for (const target of ctx.targets) {
      const report = (f: Parameters<typeof ctx.report>[0]): void => ctx.report(f);
      const doc = await ctx.readDoc(target, o.parse);
      const file = target.relPath;
      const rowNodes = doc.select(o.select);

      if (rowNodes.length === 0) {
        if (o.onNoRows === "error") {
          ctx.report({
            kind: "absence",
            message: `selector ${o.select} matched no rows`,
            locator: { file },
            expected: `at least one row at ${o.select}`,
            found: "no rows",
          });
        }
        continue;
      }

      const firstOwner = new Map<string, DocNode>();
      const keyed: { key: string; node: DocNode }[] = [];

      for (const node of rowNodes) {
        const keyNodes = node.select(o.key);
        if (keyNodes.length === 0) {
          ctx.report({
            kind: "absence",
            message: `row key ${o.key} is missing`,
            locator: { ...node.locator, file },
            expected: `a scalar at ${o.key}`,
            found: "missing",
          });
          continue;
        }
        if (keyNodes.length > 1) {
          ctx.report({
            kind: "other",
            message: `ambiguous row key (${keyNodes.length} values at ${o.key})`,
            locator: { ...node.locator, file },
            expected: `exactly one scalar at ${o.key}`,
            found: `${keyNodes.length} values`,
          });
          continue;
        }
        const keyValue = keyNodes[0]?.value;
        if (
          typeof keyValue !== "string" &&
          typeof keyValue !== "number" &&
          typeof keyValue !== "boolean"
        ) {
          ctx.report({
            kind: "mismatch",
            message: `row key ${o.key} must be a scalar`,
            locator: { ...node.locator, file },
            expected: "a scalar key",
            found: render(keyValue),
          });
          continue;
        }
        const key = String(keyValue);
        const first = firstOwner.get(key);
        if (first !== undefined) {
          ctx.report({
            kind: "other",
            message: `duplicate key ${JSON.stringify(key)} — first defined at ${first.locator.docPath ?? "?"}`,
            locator: { ...node.locator, file, nodeId: key },
            expected: "unique keys across the file",
            found: `second occurrence of ${JSON.stringify(key)}`,
          });
        } else {
          firstOwner.set(key, node);
        }
        keyed.push({ key, node });
      }

      for (const { key, node } of keyed) {
        // Column binding.
        const bound = new Map<string, DocNode>();
        for (const [name, col] of Object.entries(o.columns)) {
          const matches = node.select(col.path);
          if (matches.length === 0) {
            if (col.required) {
              ctx.report({
                kind: "absence",
                message: `row ${JSON.stringify(key)}: column "${name}" binding missing (${col.path} matched nothing)`,
                locator: { ...node.locator, file, nodeId: key },
                expected: `exactly one node at ${col.path}`,
                found: "no match",
              });
            }
            continue;
          }
          if (matches.length > 1) {
            ctx.report({
              kind: "other",
              message: `row ${JSON.stringify(key)}: column "${name}" binding ambiguous (${matches.length} nodes)`,
              locator: { ...node.locator, file, nodeId: key },
              expected: `exactly one node at ${col.path}`,
              found: `${matches.length} nodes`,
            });
            continue;
          }
          const only = matches[0];
          if (only !== undefined) bound.set(name, only);
        }

        for (const a of o.common) {
          runAssertion(report, file, node, a, key);
        }

        const expectations = o.rows[key];
        if (expectations !== undefined) {
          for (const [field, checks] of Object.entries(expectations)) {
            runCell(report, file, key, node, field, checks, bound, o);
          }
        } else if (o.closedWorld) {
          ctx.report({
            kind: "forbidden",
            message: `unexpected row ${JSON.stringify(key)} — the row set is closed`,
            locator: { ...node.locator, file, nodeId: key },
            expected: `one of: ${Object.keys(o.rows).join(", ")}`,
            found: key,
          });
        }
      }

      const presentKeys = new Set(keyed.map((k) => k.key));
      for (const expectedKey of Object.keys(o.rows)) {
        if (!presentKeys.has(expectedKey)) {
          ctx.report({
            kind: "absence",
            message: `expected row ${JSON.stringify(expectedKey)} not found`,
            locator: { file, nodeId: expectedKey },
            expected: `a row with ${o.key} = ${JSON.stringify(expectedKey)}`,
            found: "missing",
          });
        }
      }
    }
  },
});

function runCell(
  report: Reporter,
  file: string,
  key: string,
  rowNode: DocNode,
  field: string,
  checks: ValueChecks,
  bound: Map<string, DocNode>,
  o: Options,
): void {
  let values: readonly DocNode[];
  let label: string;
  if (field in o.columns) {
    const node = bound.get(field);
    if (node === undefined) return; // binding already reported
    values = [node];
    label = `column "${field}"`;
  } else if (field.startsWith("$")) {
    values = rowNode.select(field);
    label = field;
  } else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {
    values = rowNode.select(`$.${field}`);
    label = `$.${field}`;
  } else {
    // Unresolvable field name — surfaced as a config-shaped finding rather than
    // silently passing; options-level validation cannot see rows/columns coupling.
    report({
      kind: "other",
      message: `row ${JSON.stringify(key)}: field ${JSON.stringify(field)} is neither a column nor a selector`,
      locator: { ...rowNode.locator, file, nodeId: key },
      expected: "a column name, '$...' selector, or bare field name",
      found: field,
    });
    return;
  }

  if (values.length === 0) {
    if (checks.absent === true) return;
    report({
      kind: "absence",
      message: `row ${JSON.stringify(key)}: ${label} matched nothing`,
      locator: { ...rowNode.locator, file, nodeId: key },
      expected: label,
      found: "missing",
    });
    return;
  }
  if (checks.absent === true) {
    for (const v of values) {
      report({
        kind: "forbidden",
        message: `row ${JSON.stringify(key)}: forbidden value ${label} is present`,
        locator: { ...v.locator, file, nodeId: key },
        expected: "absent",
        found: render(v.value),
      });
    }
    return;
  }
  runValueChecks(report, file, label, values, checks, rowNode.locator, key);
}
