import { readFile } from "node:fs/promises";
import { builtinRegistry } from "../../rule/registry.js";

export interface RulesCliOptions {
  format: "human" | "json";
  checkDocs?: boolean | undefined;
}

/**
 * List rule types. --check-docs enforces the doc-page contract in CI: every
 * registered type ships a page whose frontmatter names it and which carries a
 * Remediation section — a rule cannot exist without agent-usable docs.
 */
export async function runRules(opts: RulesCliOptions): Promise<number> {
  const registry = builtinRegistry();
  const rows = [...registry.types.values()].map((r) => ({
    type: r.type,
    summary: r.meta.summary,
    defaultSeverity: r.meta.defaultSeverity,
  }));

  if (opts.format === "json") {
    process.stdout.write(JSON.stringify({ schemaVersion: 1, ruleTypes: rows }, null, 2) + "\n");
  } else {
    for (const r of rows) {
      process.stdout.write(`${r.type.padEnd(22)} ${r.defaultSeverity.padEnd(6)} ${r.summary}\n`);
    }
  }

  if (!opts.checkDocs) return 0;

  let failed = false;
  for (const rule of registry.types.values()) {
    try {
      const doc = await readFile(rule.meta.docsFile, "utf8");
      const problems: string[] = [];
      if (!doc.includes(`ruleId: ${rule.type}`)) {
        problems.push(`frontmatter must carry "ruleId: ${rule.type}"`);
      }
      if (!/^## Remediation$/m.test(doc)) problems.push("missing '## Remediation' section");
      if (!/^## Options$/m.test(doc)) problems.push("missing '## Options' section");
      for (const p of problems) {
        failed = true;
        process.stderr.write(`docs check: ${rule.type}: ${p} (${rule.meta.docsFile})\n`);
      }
    } catch {
      failed = true;
      process.stderr.write(`docs check: ${rule.type}: doc page missing (${rule.meta.docsFile})\n`);
    }
  }
  return failed ? 1 : 0;
}
