import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import type { DocNode } from "../../structured/doc.js";
import type { Locator } from "../../rule/types.js";
import { selectorString } from "../../selector/schema.js";
import { render } from "../shared/asserts.js";

const parseFormat = z.enum(["yaml", "yaml-multi", "json", "frontmatter"]);

/** The declaring side: where the authoritative value lives. */
const rightSide = z.strictObject({
  /** Exact path (relative to the root) of the file, POSIX separators. */
  file: z.string().min(1),
  parse: parseFormat,
  /** Selector for the anchor node(s) the value selector runs against. */
  select: selectorString.default("$"),
  /** Node-relative selector resolving the compared value. */
  value: selectorString,
});

/** The checked side: adds `key`, which names each checked node for locators. */
const leftSide = rightSide.extend({
  /** Node-relative selector for the node's identity (sets locator.nodeId). */
  key: selectorString.optional(),
});

const options = z.strictObject({
  left: leftSide,
  right: rightSide,
  relation: z.enum(["eq", "contains", "memberOf"]),
});

type Options = z.infer<typeof options>;

/**
 * Flatten resolved nodes to scalar-valued nodes: arrays expand (recursively)
 * to their elements; objects are not scalars and are dropped.
 */
function flattenScalars(nodes: readonly DocNode[]): DocNode[] {
  const out: DocNode[] = [];
  const visit = (n: DocNode): void => {
    const v = n.value;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const child = n.get(i);
        if (child) visit(child);
      }
      return;
    }
    if (v !== null && typeof v === "object") return;
    out.push(n);
  };
  for (const n of nodes) visit(n);
  return out;
}

/** Resolve a node's identity via `key`: exactly one scalar, else no identity. */
function resolveNodeId(node: DocNode, key: string | undefined): string | undefined {
  if (key === undefined) return undefined;
  const scalars = flattenScalars(node.select(key));
  if (scalars.length !== 1) return undefined;
  const value = scalars[0]?.value;
  if (value === null || value === undefined) return undefined;
  return String(value);
}

export const crossFileRule = defineRule<Options>({
  type: "cross-file",
  meta: {
    summary: "A value in one file agrees (eq/contains/memberOf) with a value declared in another",
    docs: new URL("../../../docs/rules/cross-file.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Update the left file's value to agree with the value declared in the right file " +
      "(or correct the declaration in the right file).",
    optionsSchema: options,
  },
  async check(ctx) {
    const { left, right, relation } = ctx.options;

    const leftTarget = ctx.targets.find((t) => t.relPath === left.file);
    const rightTarget = ctx.targets.find((t) => t.relPath === right.file);
    const missing = new Set<string>();
    if (!leftTarget) missing.add(left.file);
    if (!rightTarget) missing.add(right.file);
    for (const file of missing) {
      ctx.report({
        kind: "absence",
        message: `declared file ${JSON.stringify(file)} is not among this instance's targets`,
        locator: { file },
        expected: `${file} among the instance's targets`,
        found: "not a target",
        remediation:
          "Ensure the instance's targets.include covers both left.file and right.file " +
          "(and that both files exist under the root).",
      });
    }
    if (!leftTarget || !rightTarget) return;

    // Right side: resolve the declared value (eq/contains: exactly one scalar;
    // memberOf: the flattened scalar list is the member set).
    const rightDoc = await ctx.readDoc(rightTarget, right.parse);
    const rightSelected = rightDoc.select(right.select);
    const rightScalars = flattenScalars(rightSelected.flatMap((n) => n.select(right.value)));
    const rightAnchor: Locator = rightSelected[0]?.locator ?? { file: right.file };

    if (rightScalars.length === 0) {
      ctx.report({
        kind: "absence",
        message: `right value matched nothing (${right.select} then ${right.value} in ${right.file})`,
        locator: { ...rightAnchor, file: right.file },
        expected:
          relation === "memberOf"
            ? `at least one scalar at ${right.value}`
            : `exactly one scalar at ${right.value}`,
        found: "no match",
      });
      return;
    }
    const firstRight = rightScalars[0];
    if (firstRight === undefined) return; // unreachable: length checked above
    if (relation !== "memberOf" && rightScalars.length > 1) {
      ctx.report({
        kind: "other",
        message:
          `right value ambiguous (${rightScalars.length}): ` +
          `${right.select} then ${right.value} in ${right.file} must yield exactly one scalar`,
        locator: { ...firstRight.locator, file: right.file },
        expected: `exactly one scalar at ${right.value}`,
        found: `${rightScalars.length} scalars`,
      });
      return;
    }

    const provenance = ` (from ${right.file} ${firstRight.locator.docPath ?? "$"})`;
    const expectedRendered =
      relation === "memberOf"
        ? `${render(rightScalars.map((m) => m.value))}${provenance}`
        : `${render(firstRight.value)}${provenance}`;

    // Left side: check every selected node's value against the declaration.
    const leftDoc = await ctx.readDoc(leftTarget, left.parse);
    const leftSelected = leftDoc.select(left.select);
    if (leftSelected.length === 0) {
      ctx.report({
        kind: "absence",
        message: `left selector matched nothing (${left.select} in ${left.file})`,
        locator: { file: left.file },
        expected: `at least one node at ${left.select}`,
        found: "no match",
      });
      return;
    }

    for (const node of leftSelected) {
      const nodeId = resolveNodeId(node, left.key);
      const locate = (loc: Locator): Locator => ({
        ...loc,
        file: left.file,
        ...(nodeId !== undefined ? { nodeId } : {}),
      });

      const valueScalars = flattenScalars(node.select(left.value));
      if (valueScalars.length === 0) {
        ctx.report({
          kind: "absence",
          message: `left value matched nothing (${left.value} at ${node.locator.docPath ?? "$"})`,
          locator: locate(node.locator),
          expected: `exactly one scalar at ${left.value}`,
          found: "no match",
        });
        continue;
      }
      const leftNode = valueScalars[0];
      if (valueScalars.length > 1 || leftNode === undefined) {
        ctx.report({
          kind: "other",
          message: `ambiguous value: ${left.value} matched ${valueScalars.length} scalars`,
          locator: locate(node.locator),
          expected: `exactly one scalar at ${left.value}`,
          found: `${valueScalars.length} scalars`,
        });
        continue;
      }

      const leftValue = leftNode.value;
      let holds: boolean;
      let message: string;
      if (relation === "eq") {
        holds = leftValue === firstRight.value;
        message = "left value does not equal the declared right value (relation: eq)";
      } else if (relation === "contains") {
        holds = String(leftValue).includes(String(firstRight.value));
        message = "left value does not contain the declared right value (relation: contains)";
      } else {
        holds = rightScalars.some((m) => m.value === leftValue);
        message = "left value is not a member of the declared right set (relation: memberOf)";
      }
      if (!holds) {
        ctx.report({
          kind: "mismatch",
          message,
          locator: locate(leftNode.locator),
          expected: expectedRendered,
          found: render(leftValue),
        });
      }
    }
  },
});
