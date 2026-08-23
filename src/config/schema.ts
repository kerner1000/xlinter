import { z } from "zod";
import type { RawConfig, RawRuleEntry } from "./types.js";
import { XlinterConfigError } from "./types.js";

const severity = z.enum(["error", "warn", "note"]);

const CONTROL_KEYS = new Set(["type", "severity", "targets", "onEmpty"]);

const ruleEntry = z
  .looseObject({
    type: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "rule type must be kebab-case").optional(),
    severity: severity.optional(),
    targets: z
      .strictObject({
        include: z.array(z.string()).optional(),
        exclude: z.array(z.string()).optional(),
      })
      .optional(),
    onEmpty: z.enum(["na", "warn", "error"]).optional(),
  });

const markdownlintAdapter = z.strictObject({
  config: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  severity: severity.default("error"),
  rules: z.record(z.string(), z.union([severity, z.literal("off")])).default({}),
  onUnavailable: z.enum(["error", "skipped"]).default("error"),
});

export const rawConfigSchema = z.strictObject({
  version: z.literal(1),
  engine: z.string().optional(),
  namespace: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*$/, "namespace must be kebab-case")
    .default("local"),
  extends: z.array(z.string()).default([]),
  roots: z
    .array(z.strictObject({ path: z.string(), kind: z.string().default("repo") }))
    .default([{ path: ".", kind: "repo" }]),
  discovery: z.enum(["auto", "tracked", "walk"]).default("auto"),
  ignore: z.array(z.string()).default([]),
  rules: z.record(z.string(), z.union([ruleEntry, z.literal("off")])).default({}),
  exemptions: z
    .array(
      z.strictObject({
        rule: z.string(),
        file: z.string(),
        reason: z.string().min(1),
        issue: z.string().optional(),
      }),
    )
    .default([]),
  adapters: z.strictObject({ markdownlint: markdownlintAdapter.optional() }).default({}),
  plugins: z.array(z.string()).default([]),
});

/** Validate one parsed config document; zod issues become positioned config errors. */
export function validateRawConfig(data: unknown, file: string): RawConfig {
  const parsed = rawConfigSchema.safeParse(data);
  if (!parsed.success) {
    throw new XlinterConfigError(
      parsed.error.issues.map((i) => ({
        message: i.message,
        file,
        ...(i.path.length ? { path: i.path.join(".") } : {}),
      })),
    );
  }
  const v = parsed.data;
  const rules: Record<string, RawRuleEntry | "off"> = {};
  for (const [name, entry] of Object.entries(v.rules)) {
    if (entry === "off") {
      rules[name] = "off";
      continue;
    }
    const params: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(entry)) {
      if (!CONTROL_KEYS.has(k)) params[k] = val;
    }
    const raw: RawRuleEntry = { params };
    if (entry.type !== undefined) raw.type = entry.type;
    if (entry.severity !== undefined) raw.severity = entry.severity;
    if (entry.targets !== undefined) {
      raw.targets = {
        ...(entry.targets.include !== undefined ? { include: entry.targets.include } : {}),
        ...(entry.targets.exclude !== undefined ? { exclude: entry.targets.exclude } : {}),
      };
    }
    if (entry.onEmpty !== undefined) raw.onEmpty = entry.onEmpty;
    rules[name] = raw;
  }
  const cfg: RawConfig = {
    version: v.version,
    namespace: v.namespace,
    extends: v.extends,
    roots: v.roots,
    discovery: v.discovery,
    ignore: v.ignore,
    rules,
    exemptions: v.exemptions.map((e) => ({
      rule: e.rule,
      file: e.file,
      reason: e.reason,
      ...(e.issue !== undefined ? { issue: e.issue } : {}),
    })),
    adapters: v.adapters.markdownlint
      ? {
          markdownlint: {
            severity: v.adapters.markdownlint.severity,
            rules: v.adapters.markdownlint.rules,
            onUnavailable: v.adapters.markdownlint.onUnavailable,
            ...(v.adapters.markdownlint.config !== undefined
              ? { config: v.adapters.markdownlint.config }
              : {}),
          },
        }
      : {},
    plugins: v.plugins,
    file,
  };
  if (v.engine !== undefined) cfg.engine = v.engine;
  return cfg;
}
