import path from "node:path";
import { loadConfig, discoverConfigFile } from "../../config/extends.js";
import { XlinterConfigError } from "../../config/types.js";
import { engineVersion } from "../../engine/engine.js";

export interface ValidateConfigCliOptions {
  format: "human" | "json";
  configFile?: string | undefined;
}

export async function runValidateConfig(
  positionals: string[],
  opts: ValidateConfigCliOptions,
): Promise<number> {
  const file =
    positionals[0] ?? opts.configFile ?? discoverConfigFile(process.cwd());
  if (!file) {
    throw XlinterConfigError.single("no config file found or given");
  }
  const resolved = await loadConfig(path.resolve(file), engineVersion());
  if (opts.format === "json") {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: 1,
          valid: true,
          file: resolved.file,
          instances: [...resolved.rules.keys()],
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(
      `ok: ${resolved.file} (${resolved.rules.size} rule instance(s))\n`,
    );
  }
  return 0;
}
