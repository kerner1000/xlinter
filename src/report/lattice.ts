import type { Finding, RuleOutcome, Severity } from "../rule/types.js";

/**
 * Outcome derivation for one rule invocation. Order of precedence:
 * error finding > warn finding > skipped > na > pass.
 * `skipped` and `na` are distinct and both non-failing; a rule that reported
 * findings AND marked itself skipped still fails on its findings — observations
 * already made are never discarded.
 */
export function deriveOutcome(
  findings: readonly Finding[],
  flags: { skipped?: string | undefined; notApplicable?: string | undefined },
): RuleOutcome {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  if (flags.skipped !== undefined) return "skipped";
  if (flags.notApplicable !== undefined) return "na";
  return "pass";
}

/** Worst-of ordering used for run summaries. */
const ORDER: Record<RuleOutcome, number> = {
  error: 4,
  warn: 3,
  skipped: 2,
  na: 1,
  pass: 0,
};

export function worstOutcome(outcomes: readonly RuleOutcome[]): RuleOutcome {
  let worst: RuleOutcome = "pass";
  for (const o of outcomes) {
    if (ORDER[o] > ORDER[worst]) worst = o;
  }
  return worst;
}

/** Exit-code contribution: only error findings fail a run (warn under --fail-on warn). */
export function failsRun(
  findings: readonly Finding[],
  failOn: "error" | "warn",
): boolean {
  const bar: Severity[] = failOn === "warn" ? ["error", "warn"] : ["error"];
  return findings.some((f) => bar.includes(f.severity));
}
