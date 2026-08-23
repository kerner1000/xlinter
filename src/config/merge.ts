import type {
  MarkdownlintAdapterConfig,
  RawConfig,
  ResolvedConfig,
  ResolvedRuleEntry,
} from "./types.js";
import { XlinterConfigError } from "./types.js";

/**
 * Merge semantics (ESLint-classic, precisely pinned):
 * - Layers arrive parents-first (DFS left-to-right); each later layer overrides.
 * - Scalars (discovery, engine): replace.
 * - ignore / plugins / roots / exemptions: concatenate + dedupe.
 * - rules: keyed by FULL instance id. A bare name is qualified with the defining
 *   file's namespace; a name containing "/" references (overrides) an existing
 *   instance. Per entry: severity/targets/onEmpty replace per-field; params
 *   replace WHOLE when the child supplies any param key (no deep merge);
 *   `type` is immutable across layers; "off" disables (a later layer may
 *   re-enable by restating the entry).
 */
export function mergeConfigs(layers: readonly RawConfig[]): ResolvedConfig {
  const last = layers[layers.length - 1];
  if (!last) throw XlinterConfigError.single("no configuration layers to merge");

  const rules = new Map<string, ResolvedRuleEntry>();
  const ignore: string[] = [];
  const plugins: string[] = [];
  const roots: { path: string; kind: string }[] = [];
  const exemptions: ResolvedConfig["exemptions"] = [];
  let discovery: ResolvedConfig["discovery"] = "auto";
  let engine: string | undefined;
  let markdownlint: MarkdownlintAdapterConfig | undefined;

  for (const layer of layers) {
    discovery = layer.discovery;
    if (layer.engine !== undefined) engine = layer.engine;
    for (const p of layer.ignore) if (!ignore.includes(p)) ignore.push(p);
    for (const p of layer.plugins) if (!plugins.includes(p)) plugins.push(p);
    for (const r of layer.roots) {
      if (!roots.some((x) => x.path === r.path)) roots.push(r);
    }
    exemptions.push(...layer.exemptions);

    if (layer.adapters.markdownlint) {
      const a = layer.adapters.markdownlint;
      markdownlint = {
        severity: a.severity ?? markdownlint?.severity ?? "error",
        rules: { ...(markdownlint?.rules ?? {}), ...(a.rules ?? {}) },
        onUnavailable: a.onUnavailable ?? markdownlint?.onUnavailable ?? "error",
        ...((a.config ?? markdownlint?.config) !== undefined
          ? { config: (a.config ?? markdownlint?.config)! }
          : {}),
      };
    }

    for (const [name, entry] of Object.entries(layer.rules)) {
      const id = name.includes("/") ? name : `${layer.namespace}/${name}`;
      const existing = rules.get(id);

      if (entry === "off") {
        if (existing) existing.enabled = false;
        else
          rules.set(id, {
            id,
            type: "",
            enabled: false,
            onEmpty: "na",
            params: {},
            definedIn: layer.file,
          });
        continue;
      }

      if (!existing || existing.type === "") {
        if (entry.type === undefined && !existing) {
          throw XlinterConfigError.single(
            `rule instance "${id}" has no "type" and no earlier layer defines it`,
            { file: layer.file, path: `rules.${name}` },
          );
        }
        rules.set(id, {
          id,
          type: entry.type ?? existing?.type ?? "",
          enabled: true,
          onEmpty: entry.onEmpty ?? "na",
          params: entry.params,
          definedIn: layer.file,
          ...(entry.severity !== undefined ? { severity: entry.severity } : {}),
          ...(entry.targets?.include !== undefined ? { include: entry.targets.include } : {}),
          ...(entry.targets?.exclude !== undefined ? { exclude: entry.targets.exclude } : {}),
        });
        continue;
      }

      if (entry.type !== undefined && entry.type !== existing.type) {
        throw new XlinterConfigError([
          {
            message:
              `rule instance "${id}" changes type from "${existing.type}" (${existing.definedIn}) ` +
              `to "${entry.type}" — type is immutable across config layers; use a new instance name`,
            file: layer.file,
            path: `rules.${name}`,
          },
        ]);
      }

      existing.enabled = true;
      existing.definedIn = layer.file;
      if (entry.severity !== undefined) existing.severity = entry.severity;
      if (entry.targets?.include !== undefined) existing.include = entry.targets.include;
      if (entry.targets?.exclude !== undefined) existing.exclude = entry.targets.exclude;
      if (entry.onEmpty !== undefined) existing.onEmpty = entry.onEmpty;
      if (Object.keys(entry.params).length > 0) existing.params = entry.params;
    }
  }

  for (const [id, entry] of rules) {
    if (entry.enabled && entry.type === "") {
      throw XlinterConfigError.single(
        `rule instance "${id}" was re-enabled but no layer ever declared its type`,
        { file: entry.definedIn },
      );
    }
    if (!entry.enabled) rules.delete(id);
  }

  return {
    namespace: last.namespace,
    roots,
    discovery,
    ignore,
    rules,
    exemptions,
    adapters: markdownlint ? { markdownlint } : {},
    plugins,
    file: last.file,
    ...(engine !== undefined ? { engine } : {}),
  };
}
