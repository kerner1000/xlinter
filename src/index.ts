/**
 * xlinter public API. The engine is a pure library — no process.exit, no
 * direct stdout — so hosts beyond the CLI (tests, a future MCP server) import
 * from here.
 */
export { lintProject, engineVersion, type LintOptions } from "./engine/engine.js";
export type {
  RunResult,
  RunSummary,
  InstanceRollup,
} from "./engine/aggregate.js";
export { defineRule, type DefineRuleInput } from "./rule/define.js";
export type {
  DocFormat,
  Finding,
  FindingKind,
  FsNodeInfo,
  Locator,
  Note,
  ReportInput,
  RuleContext,
  RuleDescriptor,
  RuleMeta,
  RuleOutcome,
  Severity,
  Target,
  TargetRoot,
} from "./rule/types.js";
export { DocParseError, UnavailableError } from "./rule/types.js";
export type { StructuredDoc, DocNode } from "./structured/doc.js";
export type { Services } from "./engine/services.js";
export { XlinterConfigError, type ConfigErrorDetail } from "./config/types.js";
export { rawConfigSchema } from "./config/schema.js";
export { builtinRules } from "./rule/registry.js";
