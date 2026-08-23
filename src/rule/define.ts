import { fileURLToPath } from "node:url";
import type { ZodType } from "zod";
import type { RuleContext, RuleDescriptor, RuleMeta, Severity } from "./types.js";

export interface DefineRuleInput<O> {
  type: string;
  meta: {
    summary: string;
    /** URL (usually `new URL("../docs/rules/x.md", import.meta.url)`) or absolute path. */
    docs: URL | string;
    defaultSeverity: Severity;
    remediation: string;
    onUnobservable?: "skipped" | "error";
    requires?: string[];
    aliases?: string[];
    optionsSchema: ZodType<O>;
  };
  check(ctx: RuleContext<O>): void | Promise<void>;
}

/**
 * The single way to declare a rule type — builtin and plugin alike. Enforces
 * the agent-first manifest bar at definition time: a rule without a summary,
 * doc page, or remediation cannot exist.
 */
export function defineRule<O>(input: DefineRuleInput<O>): RuleDescriptor<O> {
  const { type, meta } = input;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(type)) {
    throw new Error(`rule type "${type}" must be kebab-case`);
  }
  if (!meta.summary.trim()) throw new Error(`rule type "${type}" needs a non-empty summary`);
  if (!meta.remediation.trim()) {
    throw new Error(`rule type "${type}" needs a non-empty default remediation`);
  }
  const docsFile =
    typeof meta.docs === "string" ? meta.docs : fileURLToPath(meta.docs);
  const resolved: RuleMeta<O> = {
    summary: meta.summary,
    docsFile,
    defaultSeverity: meta.defaultSeverity,
    remediation: meta.remediation,
    onUnobservable: meta.onUnobservable ?? "error",
    optionsSchema: meta.optionsSchema,
    ...(meta.requires !== undefined ? { requires: meta.requires } : {}),
    ...(meta.aliases !== undefined ? { aliases: meta.aliases } : {}),
  };
  return { type, meta: resolved, check: input.check };
}
