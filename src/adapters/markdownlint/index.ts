import path from "node:path";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import type { MarkdownlintAdapterConfig } from "../../config/types.js";
import type { Finding, Note, Severity, Target, TargetRoot } from "../../rule/types.js";
import type { InvocationResult } from "../../engine/aggregate.js";

interface MarkdownlintError {
  lineNumber: number;
  ruleNames: string[];
  ruleDescription: string;
  ruleInformation?: string;
  errorDetail?: string | null;
  errorContext?: string | null;
  errorRange?: [number, number] | null;
  fixInfo?: unknown;
}

/**
 * First adapter: markdownlint via its native Node library (exact-pinned
 * dependency — behavior-changing upstream bumps are deliberate xlinter
 * releases). Orchestration, not reimplementation: xlinter passes the user's
 * markdownlint config through untouched.
 */
export async function runMarkdownlint(
  cfg: MarkdownlintAdapterConfig,
  root: TargetRoot,
  mdTargets: readonly Target[],
  configBaseDir: string,
): Promise<InvocationResult> {
  const findings: Finding[] = [];
  const notes: Note[] = [];
  const base: Omit<InvocationResult, "findings" | "notes"> = {
    ruleId: "markdownlint",
    ruleType: "markdownlint",
    targetsMatched: mdTargets.length,
    onEmpty: "na",
    remediation: "Fix the markdown per the upstream rule's guidance.",
  };

  let lintFn: (options: unknown) => Promise<Record<string, MarkdownlintError[]>>;
  try {
    const mod = (await import("markdownlint/promise")) as {
      lint: (options: unknown) => Promise<Record<string, MarkdownlintError[]>>;
    };
    lintFn = mod.lint;
  } catch (e) {
    if (cfg.onUnavailable === "skipped") {
      return { ...base, findings, notes, skippedReason: `markdownlint unavailable: ${(e as Error).message}` };
    }
    findings.push({
      ruleId: "markdownlint",
      ruleType: "markdownlint",
      severity: "error",
      kind: "unobservable",
      message: `markdownlint library could not be loaded: ${(e as Error).message}`,
      locator: { file: "." },
      remediation: "Reinstall dependencies, or set adapters.markdownlint.onUnavailable: skipped.",
    });
    return { ...base, findings, notes };
  }

  if (mdTargets.length === 0) {
    return { ...base, findings, notes, naReason: "no markdown targets" };
  }

  // Resolve upstream config: inline object, or a path (YAML/JSON both parse via yaml).
  let mdConfig: Record<string, unknown> = {};
  if (typeof cfg.config === "string") {
    const cfgPath = path.resolve(configBaseDir, cfg.config);
    try {
      mdConfig = parseYaml(await readFile(cfgPath, "utf8")) as Record<string, unknown>;
    } catch (e) {
      findings.push({
        ruleId: "markdownlint",
        ruleType: "markdownlint",
        severity: "error",
        kind: "parse-error",
        message: `cannot read markdownlint config ${cfg.config}: ${(e as Error).message}`,
        locator: { file: cfg.config },
        remediation: "Fix the adapters.markdownlint.config path or the file's syntax.",
      });
      return { ...base, findings, notes };
    }
  } else if (cfg.config) {
    mdConfig = { ...cfg.config };
  }

  // "off" overrides are pushed into the upstream config so disabled rules are
  // not even computed; upstream accepts rule ids and aliases as keys natively.
  for (const [key, sev] of Object.entries(cfg.rules)) {
    if (sev === "off") mdConfig[key] = false;
  }

  const byPath = new Map(mdTargets.map((t) => [t.absPath, t.relPath]));
  const results = await lintFn({
    files: mdTargets.map((t) => t.absPath),
    config: mdConfig,
  });

  for (const [file, errors] of Object.entries(results)) {
    const relPath = byPath.get(file) ?? file;
    for (const err of errors ?? []) {
      const canonical = err.ruleNames[0] ?? "unknown";
      const severity = severityFor(err.ruleNames, cfg);
      if (severity === undefined) continue; // override says off (post-filter safety net)
      const message =
        err.ruleDescription + (err.errorDetail ? `: ${err.errorDetail}` : "");
      findings.push({
        ruleId: `markdownlint/${canonical}`,
        ruleType: "markdownlint",
        severity,
        kind: "mismatch",
        message,
        locator: {
          file: relPath,
          line: err.lineNumber,
          ...(err.errorRange
            ? {
                column: err.errorRange[0],
                endColumn: err.errorRange[0] + err.errorRange[1],
              }
            : {}),
        },
        remediation:
          err.ruleInformation !== undefined
            ? `Fix per the upstream rule doc: ${err.ruleInformation}`
            : "Fix the markdown per the upstream rule's guidance.",
        sourceRuleId: canonical,
        sourceRuleAliases: err.ruleNames.slice(1),
        ...(err.fixInfo !== undefined && err.fixInfo !== null ? { fix: err.fixInfo } : {}),
      });
    }
  }

  return { ...base, findings, notes };
}

/** Severity for an error: any override key matching any of the rule's names wins. */
function severityFor(
  ruleNames: readonly string[],
  cfg: MarkdownlintAdapterConfig,
): Severity | undefined {
  for (const [key, sev] of Object.entries(cfg.rules)) {
    if (ruleNames.some((n) => n.toLowerCase() === key.toLowerCase())) {
      return sev === "off" ? undefined : sev;
    }
  }
  return cfg.severity;
}
