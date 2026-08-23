import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import { comparePaths } from "../../structured/doc.js";
import { selectorString } from "../../selector/schema.js";
import { assertion, runAssertion } from "../shared/asserts.js";

const options = z.strictObject({
  parse: z.enum(["yaml", "yaml-multi", "json", "frontmatter"]),
  /** Selector for the nodes each assertion runs against. */
  select: selectorString,
  /** Fail (kind: absence) when `select` matches no node in a file. */
  requireMatch: z.boolean().default(false),
  assert: z.array(assertion).min(1),
  /**
   * Document-order constraints, evaluated against the document root: every
   * node matched by `before` must precede every node matched by `after`.
   */
  order: z
    .array(z.strictObject({ before: selectorString, after: selectorString }))
    .default([]),
});

type Options = z.infer<typeof options>;

export const nodesRule = defineRule<Options>({
  type: "nodes",
  meta: {
    summary: "Structured-document nodes satisfy scalar assertions (YAML/JSON/frontmatter)",
    docs: new URL("../../../docs/rules/nodes.md", import.meta.url),
    defaultSeverity: "error",
    remediation: "Set the named field on the named node to a value satisfying the assertion.",
    optionsSchema: options,
  },
  async check(ctx) {
    for (const target of ctx.targets) {
      const doc = await ctx.readDoc(target, ctx.options.parse);
      const selected = doc.select(ctx.options.select);
      if (selected.length === 0 && ctx.options.requireMatch) {
        ctx.report({
          kind: "absence",
          message: `selector ${ctx.options.select} matched no node`,
          locator: { file: target.relPath },
          expected: `at least one node at ${ctx.options.select}`,
          found: "no match",
        });
        continue;
      }
      for (const node of selected) {
        for (const a of ctx.options.assert) {
          runAssertion((f) => ctx.report(f), target.relPath, node, a);
        }
      }
      for (const o of ctx.options.order) {
        const befores = doc.select(o.before);
        const afters = doc.select(o.after);
        if (befores.length === 0 || afters.length === 0) {
          ctx.report({
            kind: "absence",
            message:
              befores.length === 0
                ? `order constraint: ${o.before} matched no node`
                : `order constraint: ${o.after} matched no node`,
            locator: { file: target.relPath },
            expected: "both order selectors match at least one node",
            found: befores.length === 0 ? `${o.before}: no match` : `${o.after}: no match`,
          });
          continue;
        }
        for (const b of befores) {
          for (const a of afters) {
            if (comparePaths(b.path, a.path) >= 0) {
              ctx.report({
                kind: "mismatch",
                message: `order violation: ${o.before} must precede ${o.after}`,
                locator: { ...a.locator, file: target.relPath },
                expected: `${o.before} before ${o.after}`,
                found: `${b.locator.docPath ?? "?"} at or after ${a.locator.docPath ?? "?"}`,
              });
            }
          }
        }
      }
    }
  },
});
