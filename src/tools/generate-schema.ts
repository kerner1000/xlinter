/**
 * Emit schema/xlinter-config.schema.json from the zod source of truth.
 * The generated file is committed and published (`xlinter/schema.json`);
 * CI fails when it is stale, guaranteeing schema/validator agreement.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { z } from "zod";
import { rawConfigSchema } from "../config/schema.js";
import { builtinRules } from "../rule/registry.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

const schema = z.toJSONSchema(rawConfigSchema, {
  target: "draft-2020-12",
  io: "input",
  unrepresentable: "any",
}) as Record<string, unknown>;

schema["$id"] = "https://github.com/kerner1000/xlinter/blob/main/schema/xlinter-config.schema.json";
schema["title"] = "xlinter configuration (.xlinter.yaml)";

// Fold each builtin rule type's options schema in under $defs so agents get
// per-type parameter validation from the one published document.
const defs: Record<string, unknown> = {};
for (const rule of builtinRules) {
  defs[`ruleType:${rule.type}`] = z.toJSONSchema(rule.meta.optionsSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "any",
  });
}
schema["$defs"] = { ...(schema["$defs"] as object | undefined), ...defs };

const outPath = path.join(repoRoot, "schema", "xlinter-config.schema.json");
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(schema, null, 2) + "\n");
process.stdout.write(`wrote ${outPath}\n`);
