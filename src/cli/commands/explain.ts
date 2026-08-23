import { readFile } from "node:fs/promises";
import { XlinterConfigError } from "../../config/types.js";
import { builtinRegistry, resolveType } from "../../rule/registry.js";
import { resolveConfigForCwd } from "../../engine/engine.js";

export interface ExplainCliOptions {
  format: "human" | "json";
  configFile?: string | undefined;
}

export async function runExplain(positionals: string[], opts: ExplainCliOptions): Promise<number> {
  const id = positionals[0];
  if (!id) throw XlinterConfigError.single("explain needs a rule type, instance id, or adapter rule id");

  const registry = builtinRegistry();

  if (id.toLowerCase().startsWith("markdownlint/")) {
    const upstream = id.slice("markdownlint/".length).toLowerCase();
    process.stdout.write(
      [
        `# ${id}`,
        "",
        "Adapter rule: produced by the markdownlint adapter (exact-pinned upstream).",
        `Upstream documentation: https://github.com/DavidAnson/markdownlint/blob/main/doc/${upstream}.md`,
        "",
        "Severity is controlled in .xlinter.yaml under adapters.markdownlint.rules;",
        '"off" entries are pushed into the passthrough config so disabled rules are never computed.',
        "",
      ].join("\n"),
    );
    return 0;
  }

  const asType = resolveType(registry, id);
  if (asType) {
    process.stdout.write(await readFile(asType.rule.meta.docsFile, "utf8"));
    return 0;
  }

  if (id.includes("/")) {
    // Instance id: resolve through the nearest config for provenance + params.
    const config = await resolveConfigForCwd({
      ...(opts.configFile !== undefined ? { configFile: opts.configFile } : {}),
    });
    const instance = config.rules.get(id);
    if (!instance) {
      throw XlinterConfigError.single(`no rule instance "${id}" in the resolved config`);
    }
    const type = resolveType(registry, instance.type);
    process.stdout.write(
      [
        `# ${id}`,
        "",
        `type: ${instance.type}`,
        `defined in: ${instance.definedIn}`,
        `severity: ${instance.severity ?? type?.rule.meta.defaultSeverity ?? "(type default)"}`,
        `options: ${JSON.stringify(instance.params, null, 2)}`,
        "",
      ].join("\n"),
    );
    if (type) {
      process.stdout.write("---\n\n" + (await readFile(type.rule.meta.docsFile, "utf8")));
    }
    return 0;
  }

  throw XlinterConfigError.single(`unknown rule "${id}" — try \`xlinter rules\``);
}
