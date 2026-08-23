import type { RawExemption } from "../config/types.js";
import type { Finding, Note, RuleOutcome } from "../rule/types.js";
import { deriveOutcome, failsRun } from "../report/lattice.js";

export interface InvocationResult {
  ruleId: string;
  ruleType: string;
  findings: Finding[];
  notes: Note[];
  targetsMatched: number;
  skippedReason?: string;
  naReason?: string;
  onEmpty: "na" | "warn" | "error";
  remediation: string;
}

export interface InstanceRollup {
  ruleId: string;
  ruleType: string;
  outcome: RuleOutcome;
  findingCount: number;
  targetsMatched: number;
  reason?: string;
}

export interface RunSummary {
  errors: number;
  warns: number;
  notes: number;
  instances: number;
  pass: number;
  na: number;
  skipped: number;
}

export interface RunResult {
  schemaVersion: 1;
  findings: Finding[];
  notes: Note[];
  instances: InstanceRollup[];
  summary: RunSummary;
  failed: boolean;
}

/**
 * The pinned aggregation order — the ordering contract several original
 * systems regression-test (a stale exemption must never be masked by an
 * empty input):
 *
 *   1. collect all findings
 *   2. exemption filter + audit (zero-effect entries are ERRORS)
 *   3. per-instance onEmpty guard
 *   4. summary / failure derivation
 */
export function aggregate(
  invocations: readonly InvocationResult[],
  exemptions: readonly RawExemption[],
  failOn: "error" | "warn",
): RunResult {
  const notes: Note[] = [];
  const findings: Finding[] = [];
  const instances: InstanceRollup[] = [];

  // Step 2 bookkeeping: how many findings each exemption entry suppressed.
  const suppressedCount = new Map<RawExemption, number>();
  for (const ex of exemptions) suppressedCount.set(ex, 0);

  const perInstanceFindings = new Map<string, Finding[]>();

  for (const inv of invocations) {
    const kept: Finding[] = [];
    for (const f of inv.findings) {
      const ex = exemptions.find(
        (e) => e.rule === f.ruleId && e.file === f.locator.file,
      );
      if (ex && f.kind === "absence") {
        suppressedCount.set(ex, (suppressedCount.get(ex) ?? 0) + 1);
        notes.push({
          message: `exempted: ${f.message} (${ex.reason}${ex.issue ? `, ${ex.issue}` : ""})`,
          ruleId: f.ruleId,
          locator: f.locator,
        });
        continue;
      }
      kept.push(f);
    }
    perInstanceFindings.set(inv.ruleId, [
      ...(perInstanceFindings.get(inv.ruleId) ?? []),
      ...kept,
    ]);
    notes.push(...inv.notes);
  }

  // Exemption audit — anti-monotone ratchet: an entry that suppressed nothing
  // is itself an error, diagnosed by sub-case.
  const invByRule = new Map<string, InvocationResult[]>();
  for (const inv of invocations) {
    invByRule.set(inv.ruleId, [...(invByRule.get(inv.ruleId) ?? []), inv]);
  }
  for (const ex of exemptions) {
    if ((suppressedCount.get(ex) ?? 0) > 0) continue;
    const ruleInvs = invByRule.get(ex.rule);
    let message: string;
    if (!ruleInvs || ruleInvs.length === 0) {
      message = `stale exemption: no rule instance "${ex.rule}" ran`;
    } else {
      const hadNonAbsence = (perInstanceFindings.get(ex.rule) ?? []).some(
        (f) => f.locator.file === ex.file,
      );
      message = hadNonAbsence
        ? `exemption for ${ex.rule} on ${ex.file} cannot cover a present-but-wrong value — exemptions suppress absence only`
        : `exemption for ${ex.rule} on ${ex.file} suppressed nothing — the target passes or is out of scope; remove the entry (the list may only shrink)`;
    }
    findings.push({
      ruleId: ex.rule,
      ruleType: "exemptions",
      severity: "error",
      kind: "other",
      message,
      locator: { file: ex.file },
      remediation:
        "Delete this exemptions entry, or fix its `rule`/`file` reference if it drifted.",
    });
  }

  // Step 3: per-instance onEmpty guard + rollups.
  for (const inv of invocations) {
    const instanceFindings = perInstanceFindings.get(inv.ruleId) ?? [];
    if (
      inv.targetsMatched === 0 &&
      inv.skippedReason === undefined &&
      inv.naReason === undefined &&
      inv.onEmpty !== "na"
    ) {
      instanceFindings.push({
        ruleId: inv.ruleId,
        ruleType: inv.ruleType,
        severity: inv.onEmpty,
        kind: "absence",
        message: `no targets matched this rule instance — its scope may have rotted`,
        locator: { file: "." },
        remediation:
          "Fix the instance's targets.include patterns, or set onEmpty: na if zero matches is legitimate.",
      });
    }
    const flags = {
      skipped: inv.skippedReason,
      notApplicable:
        inv.naReason ??
        (inv.targetsMatched === 0 && inv.onEmpty === "na" && inv.skippedReason === undefined
          ? "no targets matched"
          : undefined),
    };
    const outcome = deriveOutcome(instanceFindings, flags);
    const reason = flags.skipped ?? flags.notApplicable;
    instances.push({
      ruleId: inv.ruleId,
      ruleType: inv.ruleType,
      outcome,
      findingCount: instanceFindings.length,
      targetsMatched: inv.targetsMatched,
      ...(reason !== undefined ? { reason } : {}),
    });
    findings.push(...instanceFindings);
  }

  findings.sort(
    (a, b) =>
      a.locator.file.localeCompare(b.locator.file) ||
      (a.locator.line ?? 0) - (b.locator.line ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const summary: RunSummary = {
    errors: findings.filter((f) => f.severity === "error").length,
    warns: findings.filter((f) => f.severity === "warn").length,
    notes: notes.length,
    instances: instances.length,
    pass: instances.filter((i) => i.outcome === "pass").length,
    na: instances.filter((i) => i.outcome === "na").length,
    skipped: instances.filter((i) => i.outcome === "skipped").length,
  };

  return {
    schemaVersion: 1,
    findings,
    notes,
    instances,
    summary,
    failed: failsRun(findings, failOn),
  };
}
