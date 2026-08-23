import type { RunResult } from "../../engine/aggregate.js";

export function formatHuman(result: RunResult): string {
  const out: string[] = [];
  for (const f of result.findings) {
    const loc = f.locator.line !== undefined ? `${f.locator.file}:${f.locator.line}` : f.locator.file;
    const docPath = f.locator.docPath ? ` at ${f.locator.docPath}` : "";
    out.push(`${loc}: [${f.severity}] ${f.ruleId} — ${f.message}${docPath}`);
    if (f.expected !== undefined || f.found !== undefined) {
      out.push(`    expected: ${f.expected ?? "-"}  found: ${f.found ?? "-"}`);
    }
    out.push(`    fix: ${f.remediation}`);
    if (f.repairHint) out.push(`    run: ${f.repairHint}`);
  }
  if (result.notes.length > 0) {
    out.push("");
    for (const n of result.notes) out.push(`NOTE: ${n.message}`);
  }
  const quiet = result.instances.filter((i) => i.outcome === "skipped" || i.outcome === "na");
  if (quiet.length > 0) {
    out.push("");
    for (const i of quiet) {
      out.push(`${i.outcome === "na" ? "n/a" : "skipped"}: ${i.ruleId}${i.reason ? ` (${i.reason})` : ""}`);
    }
  }
  out.push("");
  const s = result.summary;
  out.push(
    result.failed
      ? `FAIL: ${s.errors} error(s), ${s.warns} warning(s) across ${s.instances} rule instance(s)`
      : `PASS: ${s.instances} rule instance(s) — ${s.pass} pass, ${s.na} n/a, ${s.skipped} skipped, ${s.warns} warning(s)`,
  );
  return out.join("\n");
}
