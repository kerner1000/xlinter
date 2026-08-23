import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RuleDescriptor } from "./types.js";
import { XlinterConfigError } from "../config/types.js";
import { fileNameRule } from "../rules/file-name/rule.js";
import { filePairingRule } from "../rules/file-pairing/rule.js";
import { firstHeadingRule } from "../rules/first-heading/rule.js";
import { indexCompletenessRule } from "../rules/index-completeness/rule.js";
import { nodesRule } from "../rules/nodes/rule.js";

export const builtinRules: readonly RuleDescriptor<never>[] = [
  fileNameRule,
  filePairingRule,
  firstHeadingRule,
  indexCompletenessRule,
  nodesRule,
] as unknown as RuleDescriptor<never>[];

export interface Registry {
  /** type id (canonical) → descriptor */
  types: Map<string, RuleDescriptor<unknown>>;
  /** alias → canonical type id */
  aliases: Map<string, string>;
}

export function builtinRegistry(): Registry {
  const registry: Registry = { types: new Map(), aliases: new Map() };
  for (const rule of builtinRules) addRule(registry, rule as RuleDescriptor<unknown>);
  return registry;
}

function addRule(registry: Registry, rule: RuleDescriptor<unknown>): void {
  if (registry.types.has(rule.type)) {
    throw XlinterConfigError.single(`duplicate rule type "${rule.type}"`);
  }
  registry.types.set(rule.type, rule);
  for (const alias of rule.meta.aliases ?? []) registry.aliases.set(alias, rule.type);
}

/**
 * Load plugin rule packs. A plugin is an ESM module (local path relative to the
 * config file, or a package specifier) whose default export or `rules` export
 * is an array of RuleDescriptors. Plugin type ids are qualified with the
 * specifier (`<spec>:<type>`) so collisions with builtins are impossible.
 */
export async function loadPlugins(
  registry: Registry,
  specifiers: readonly string[],
  configFile: string,
): Promise<void> {
  for (const spec of specifiers) {
    const isLocal = spec.startsWith("./") || spec.startsWith("../") || path.isAbsolute(spec);
    const importTarget = isLocal
      ? pathToFileURL(path.resolve(path.dirname(configFile), spec)).href
      : spec;
    let mod: Record<string, unknown>;
    try {
      mod = (await import(importTarget)) as Record<string, unknown>;
    } catch (e) {
      throw XlinterConfigError.single(
        `cannot load plugin "${spec}": ${(e as Error).message}`,
        { file: configFile },
      );
    }
    const exported = (mod["rules"] ?? mod["default"]) as unknown;
    if (!Array.isArray(exported) || exported.length === 0) {
      throw XlinterConfigError.single(
        `plugin "${spec}" must export a non-empty \`rules\` array (or default export) of rule descriptors`,
        { file: configFile },
      );
    }
    for (const rule of exported as RuleDescriptor<unknown>[]) {
      if (!rule?.type || typeof rule.check !== "function" || !rule.meta) {
        throw XlinterConfigError.single(
          `plugin "${spec}" exported something that is not a rule descriptor — use defineRule()`,
          { file: configFile },
        );
      }
      const qualified: RuleDescriptor<unknown> = {
        ...rule,
        type: `${spec}:${rule.type}`,
      };
      addRule(registry, qualified);
    }
  }
}

/** Resolve a configured type id, following aliases (returns canonical id). */
export function resolveType(
  registry: Registry,
  typeId: string,
): { rule: RuleDescriptor<unknown>; canonical: string; viaAlias: boolean } | undefined {
  const direct = registry.types.get(typeId);
  if (direct) return { rule: direct, canonical: typeId, viaAlias: false };
  const canonical = registry.aliases.get(typeId);
  if (canonical) {
    const rule = registry.types.get(canonical);
    if (rule) return { rule, canonical, viaAlias: true };
  }
  return undefined;
}
