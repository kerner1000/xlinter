import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import type { DocNode } from "../../structured/doc.js";
import type { Locator } from "../../rule/types.js";

const assertion = z.strictObject({
  /** Node-relative selector for the value(s) under test. */
  path: z.string().min(1),
  required: z.boolean().optional(),
  absent: z.boolean().optional(),
  eq: z.unknown().optional(),
  regex: z.string().optional(),
  enum: z.array(z.unknown()).optional(),
  contains: z.string().optional(),
  notContains: z.string().optional(),
});

const options = z.strictObject({
  parse: z.enum(["yaml", "yaml-multi", "json", "frontmatter"]),
  /** Selector for the nodes each assertion runs against. */
  select: z.string().min(1),
  /** Fail (kind: absence) when `select` matches no node in a file. */
  requireMatch: z.boolean().default(false),
  assert: z.array(assertion).min(1),
});

type Options = z.infer<typeof options>;
type Assertion = z.infer<typeof assertion>;

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
          checkAssertion(ctx, target.relPath, node, a);
        }
      }
    }
  },
});

function checkAssertion(
  ctx: Parameters<NonNullable<(typeof nodesRule)["check"]>>[0],
  file: string,
  node: DocNode,
  a: Assertion,
): void {
  const values = node.select(a.path);
  const at = (loc: Locator): Locator => ({ ...loc, file });

  if (a.required === true && values.length === 0) {
    ctx.report({
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
      ctx.report({
        kind: "forbidden",
        message: `forbidden value ${a.path} is present`,
        locator: at(v.locator),
        expected: "absent",
        found: render(v.value),
      });
    }
    return;
  }

  for (const v of values) {
    const value = v.value;
    if (a.eq !== undefined && !deepEqual(value, a.eq)) {
      ctx.report({
        kind: "mismatch",
        message: `${a.path} has the wrong value`,
        locator: at(v.locator),
        expected: render(a.eq),
        found: render(value),
      });
    }
    if (a.regex !== undefined && !new RegExp(a.regex).test(String(value))) {
      ctx.report({
        kind: "mismatch",
        message: `${a.path} does not match /${a.regex}/`,
        locator: at(v.locator),
        expected: `match /${a.regex}/`,
        found: render(value),
      });
    }
    if (a.enum !== undefined && !a.enum.some((e) => deepEqual(value, e))) {
      ctx.report({
        kind: "mismatch",
        message: `${a.path} is not one of the allowed values`,
        locator: at(v.locator),
        expected: a.enum.map(render).join(" | "),
        found: render(value),
      });
    }
    if (a.contains !== undefined && !String(value).includes(a.contains)) {
      ctx.report({
        kind: "mismatch",
        message: `${a.path} does not contain the required substring`,
        locator: at(v.locator),
        expected: `contains ${JSON.stringify(a.contains)}`,
        found: render(value),
      });
    }
    if (a.notContains !== undefined && String(value).includes(a.notContains)) {
      ctx.report({
        kind: "forbidden",
        message: `${a.path} contains a forbidden substring`,
        locator: at(v.locator),
        expected: `does not contain ${JSON.stringify(a.notContains)}`,
        found: render(value),
      });
    }
  }
}

function render(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
