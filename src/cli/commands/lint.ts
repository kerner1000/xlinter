import { lintProject, resolveConfigForCwd } from "../../engine/engine.js";
import { resolveTargets } from "../../engine/targets.js";
import { formatHuman } from "../formats/human.js";
import { formatJson } from "../formats/json.js";

export interface LintCliOptions {
  format: "human" | "json";
  configFile?: string | undefined;
  failOn: "error" | "warn";
  rulesFilter?: string[] | undefined;
  listTargets?: boolean | undefined;
}

export async function runLint(paths: string[], opts: LintCliOptions): Promise<number> {
  if (opts.listTargets) {
    const config = await resolveConfigForCwd({
      ...(opts.configFile !== undefined ? { configFile: opts.configFile } : {}),
    });
    const { targets } = await resolveTargets(config);
    for (const t of targets) process.stdout.write(`${t.relPath}\n`);
    return 0;
  }
  const result = await lintProject({
    ...(opts.configFile !== undefined ? { configFile: opts.configFile } : {}),
    ...(paths.length > 0 ? { paths } : {}),
    ...(opts.rulesFilter !== undefined ? { rulesFilter: opts.rulesFilter } : {}),
    failOn: opts.failOn,
  });
  const output = opts.format === "json" ? formatJson(result) : formatHuman(result);
  process.stdout.write(output + "\n");
  return result.failed ? 1 : 0;
}
