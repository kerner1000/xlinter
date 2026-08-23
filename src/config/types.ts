import type { Severity } from "../rule/types.js";

/** One entry in a raw config's `rules:` map, before merging. */
export interface RawRuleEntry {
  type?: string;
  severity?: Severity;
  targets?: { include?: string[]; exclude?: string[] };
  onEmpty?: "na" | "warn" | "error";
  /** Everything else: rule-type parameters, validated against the type's optionsSchema. */
  params: Record<string, unknown>;
}

export interface RawExemption {
  rule: string;
  file: string;
  reason: string;
  issue?: string;
}

export interface MarkdownlintAdapterConfig {
  config?: string | Record<string, unknown>;
  severity: Severity;
  rules: Record<string, Severity | "off">;
  onUnavailable: "error" | "skipped";
}

/** A single config file after zod validation, before extends-merging. */
export interface RawConfig {
  version: 1;
  engine?: string;
  namespace: string;
  extends: string[];
  roots: { path: string; kind: string }[];
  discovery: "auto" | "tracked" | "walk";
  ignore: string[];
  /** Keys are instance names as written (bare or full-ID). */
  rules: Record<string, RawRuleEntry | "off">;
  exemptions: RawExemption[];
  adapters: { markdownlint?: Partial<MarkdownlintAdapterConfig> };
  plugins: string[];
  /** Absolute path of the file this config was loaded from. */
  file: string;
}

/** Fully merged configuration. Instance keys are always full IDs (`namespace/name`). */
export interface ResolvedConfig {
  engine?: string;
  namespace: string;
  roots: { path: string; kind: string }[];
  discovery: "auto" | "tracked" | "walk";
  ignore: string[];
  rules: Map<string, ResolvedRuleEntry>;
  exemptions: RawExemption[];
  adapters: { markdownlint?: MarkdownlintAdapterConfig };
  plugins: string[];
  /** The entry config file (for relative-path resolution of roots). */
  file: string;
}

export interface ResolvedRuleEntry {
  id: string;
  type: string;
  enabled: boolean;
  severity?: Severity;
  include?: string[];
  exclude?: string[];
  onEmpty: "na" | "warn" | "error";
  params: Record<string, unknown>;
  /** File that last touched this entry (provenance for `explain`). */
  definedIn: string;
}

export interface ConfigErrorDetail {
  message: string;
  file?: string;
  path?: string;
  line?: number;
}

/** Any configuration or usage problem — maps to exit code 2, never a lint failure. */
export class XlinterConfigError extends Error {
  constructor(readonly details: ConfigErrorDetail[]) {
    super(details.map((d) => d.message).join("; "));
    this.name = "XlinterConfigError";
  }
  static single(message: string, where: Omit<ConfigErrorDetail, "message"> = {}): XlinterConfigError {
    return new XlinterConfigError([{ message, ...where }]);
  }
}
