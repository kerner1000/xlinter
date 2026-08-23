import type { ZodType } from "zod";
import type { StructuredDoc } from "../structured/doc.js";
import type { Services } from "../engine/services.js";

/** Finding severity. `note` is advisory and never fails a run. */
export type Severity = "error" | "warn" | "note";

/**
 * Per (rule-instance × root) outcome. `na` (rule does not apply here) and
 * `skipped` (could not observe) are distinct and both non-failing.
 */
export type RuleOutcome = "error" | "warn" | "pass" | "na" | "skipped";

/**
 * What failed, structurally. Exemptions may suppress only `absence` findings;
 * `parse-error` marks target content the rule asked for but could not parse
 * (always an error — the content is the thing under test); `unobservable`
 * marks a declared environmental capability that was unavailable.
 */
export type FindingKind =
  | "absence"
  | "mismatch"
  | "forbidden"
  | "parse-error"
  | "unobservable"
  | "other";

export type DocFormat = "yaml" | "yaml-multi" | "json" | "frontmatter";

export interface Locator {
  /** Path relative to the target root, POSIX separators. */
  file: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  /** Path into a structured document, e.g. "$.groups[0].rules[2].uid". */
  docPath?: string;
  /** Document index within a multi-document file. */
  docIndex?: number;
  /** Node identity (uid/name) — survives reordering; powers node-keyed exemptions later. */
  nodeId?: string;
}

export interface Finding {
  /** Instance id (`namespace/name`) or adapter rule id (`markdownlint/MD013`). */
  ruleId: string;
  /** Rule type id (`file-name`, …) or adapter name (`markdownlint`). */
  ruleType: string;
  severity: Severity;
  kind: FindingKind;
  message: string;
  locator: Locator;
  /** One sentence an agent can act on. Always present (falls back to the rule's default). */
  remediation: string;
  expected?: string;
  found?: string;
  /** Optional copy-pasteable fix (shell command or replacement text). */
  repairHint?: string;
  /** Structured fix data passed through from an adapter (e.g. markdownlint fixInfo). */
  fix?: unknown;
  /** Adapter-native rule id when produced by an adapter. */
  sourceRuleId?: string;
  /** Adapter-native aliases for the source rule. */
  sourceRuleAliases?: string[];
}

/** Advisory line surfaced with the results (honored exemptions, active seams). */
export interface Note {
  message: string;
  ruleId?: string;
  locator?: Locator;
}

export interface TargetRoot {
  absPath: string;
  /** Config-declared classification, e.g. "repo" | "workspace-root". */
  kind: string;
  /** Present when the root is a git repository. */
  git?: { present: true };
}

export interface Target {
  /** Absolute realpath — the dedup key across symlink-published trees. */
  absPath: string;
  /** Path relative to its root, POSIX separators — the locator path. */
  relPath: string;
  root: TargetRoot;
  nodeType: "file" | "symlink";
}

export interface FsNodeInfo {
  nodeType: "file" | "symlink" | "dir" | "missing";
  /** Raw symlink target when nodeType is "symlink". */
  symlinkTarget?: string;
  size?: number;
}

export interface ReportInput {
  kind: FindingKind;
  message: string;
  locator: Locator;
  severity?: Severity;
  expected?: string;
  found?: string;
  remediation?: string;
  repairHint?: string;
  fix?: unknown;
  sourceRuleId?: string;
  sourceRuleAliases?: string[];
}

/**
 * The observation and reporting surface handed to a rule's check().
 * Rules never touch fs/network directly — everything flows through here,
 * which is what makes fixture injection and future concurrency safe.
 */
export interface RuleContext<O = unknown> {
  /** Instance id, e.g. "xlinter/rule-doc-names". */
  readonly instanceId: string;
  readonly options: O;
  /** Files matched for this instance (already include/exclude-filtered). */
  readonly targets: readonly Target[];
  readonly root: TargetRoot;
  readonly services: Services;

  readText(target: Target): Promise<string>;
  /** Parse a target as a structured document. Throws DocParseError on malformed content. */
  readDoc(target: Target, format: DocFormat): Promise<StructuredDoc>;
  stat(target: Target): Promise<FsNodeInfo>;
  /** List paths (relative, POSIX) that exist under the root and match the instance scope. */

  report(finding: ReportInput): void;
  note(message: string, locator?: Locator): void;
  /** Declare this invocation unobservable (reason required); lattice applies onUnobservable. */
  markSkipped(reason: string): void;
  /** Declare the rule inapplicable to this root (reason required). */
  markNotApplicable(reason: string): void;
}

export interface RuleMeta<O = unknown> {
  /** One-liner for `xlinter rules`. */
  summary: string;
  /** Absolute path of the rule's markdown doc page (resolved by defineRule). */
  docsFile: string;
  defaultSeverity: Severity;
  /** Default remediation used when a finding does not carry its own. */
  remediation: string;
  /** Observability contract: what an unavailable declared capability becomes. */
  onUnobservable: "skipped" | "error";
  /** Declared environmental capabilities, e.g. ["network", "subprocess:kustomize"]. */
  requires?: string[];
  /** Accepted historical names for this rule type. */
  aliases?: string[];
  /** Zod schema validating the instance options; folded into the published config schema. */
  optionsSchema: ZodType<O>;
}

export interface RuleDescriptor<O = unknown> {
  /** Stable public type id: builtin "kebab-name"; plugin types are package-qualified at load. */
  type: string;
  meta: RuleMeta<O>;
  check(ctx: RuleContext<O>): void | Promise<void>;
}

/** Thrown by structured parsing when target content is malformed. */
export class DocParseError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly line?: number,
  ) {
    super(message);
    this.name = "DocParseError";
  }
}

/** Thrown by Services stubs for undeclared/unavailable environmental capabilities. */
export class UnavailableError extends Error {
  constructor(readonly capability: string) {
    super(`capability unavailable: ${capability}`);
    this.name = "UnavailableError";
  }
}
