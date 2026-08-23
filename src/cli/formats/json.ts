import type { RunResult } from "../../engine/aggregate.js";
import type { ConfigErrorDetail } from "../../config/types.js";

export function formatJson(result: RunResult): string {
  return JSON.stringify(result, null, 2);
}

/** Config errors also get a machine-readable envelope — agents author configs. */
export function formatConfigErrorsJson(details: ConfigErrorDetail[]): string {
  return JSON.stringify({ schemaVersion: 1, configErrors: details }, null, 2);
}
