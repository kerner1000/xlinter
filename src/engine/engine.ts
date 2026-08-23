import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { discoverConfigFile, loadConfig } from "../config/extends.js";
import { XlinterConfigError, type ResolvedConfig, type ResolvedRuleEntry } from "../config/types.js";
import { builtinRegistry, loadPlugins, resolveType } from "../rule/registry.js";
import {
  DocParseError,
  UnavailableError,
  type DocFormat,
  type Finding,
  type Note,
  type ReportInput,
  type RuleContext,
  type RuleDescriptor,
  type Target,
  type TargetRoot,
} from "../rule/types.js";
import { parseStructured } from "../structured/parse.js";
import { realServices, type Services } from "./services.js";
import { resolveTargets, scopeMatcher } from "./targets.js";
import { aggregate, type InvocationResult, type RunResult } from "./aggregate.js";
import { runMarkdownlint } from "../adapters/markdownlint/index.js";

export interface LintOptions {
  /** Directory to discover config from (default: process.cwd()). */
  cwd?: string;
  /** Explicit config file (overrides discovery). */
  configFile?: string;
  /** Narrow targets to these paths (files or directory prefixes, relative to cwd). */
  paths?: string[];
  /** Run only these rule instance ids. */
  rulesFilter?: string[];
  failOn?: "error" | "warn";
}

export function engineVersion(): string {
  const pkgPath = fileURLToPath(new URL("../../package.json", import.meta.url));
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

export async function resolveConfigForCwd(opts: LintOptions): Promise<ResolvedConfig> {
  const cwd = opts.cwd ?? process.cwd();
  const configFile = opts.configFile ?? discoverConfigFile(cwd);
  if (!configFile) {
    throw XlinterConfigError.single(
      `no .xlinter.yaml found from ${cwd} upward — create one or pass --config`,
    );
  }
  return loadConfig(configFile, engineVersion());
}

/**
 * The engine: pure async function, no process.exit, no direct stdout — this is
 * the seam a future MCP server imports.
 */
export async function lintProject(opts: LintOptions = {}): Promise<RunResult> {
  const config = await resolveConfigForCwd(opts);
  const registry = builtinRegistry();
  await loadPlugins(registry, config.plugins, config.file);

  const services = realServices();
  const { roots, targets } = await resolveTargets(config);

  const narrowed = narrowTargets(targets, opts.paths, opts.cwd ?? process.cwd());
  const invocations: InvocationResult[] = [];

  for (const entry of config.rules.values()) {
    if (opts.rulesFilter && !opts.rulesFilter.includes(entry.id)) continue;
    const resolved = resolveType(registry, entry.type);
    if (!resolved) {
      throw XlinterConfigError.single(
        `unknown rule type "${entry.type}" for instance "${entry.id}"` +
          (config.plugins.length === 0 ? " (no plugins configured)" : ""),
        { file: entry.definedIn },
      );
    }
    const optionsParse = resolved.rule.meta.optionsSchema.safeParse(entry.params);
    if (!optionsParse.success) {
      throw new XlinterConfigError(
        optionsParse.error.issues.map((i) => ({
          message: `invalid options for "${entry.id}" (${resolved.canonical}): ${i.message}`,
          file: entry.definedIn,
          ...(i.path.length ? { path: `rules.${entry.id}.${i.path.join(".")}` } : {}),
        })),
      );
    }
    for (const root of roots) {
      const inv = await runInstance(
        resolved.rule,
        resolved.canonical,
        entry,
        optionsParse.data,
        root,
        narrowed.filter((t) => t.root === root),
        services,
      );
      if (resolved.viaAlias) {
        inv.notes.push({
          message: `rule type "${entry.type}" is a deprecated alias of "${resolved.canonical}"`,
          ruleId: entry.id,
        });
      }
      invocations.push(inv);
    }
  }

  if (config.adapters.markdownlint) {
    for (const root of roots) {
      invocations.push(
        await runMarkdownlint(
          config.adapters.markdownlint,
          root,
          narrowed.filter((t) => t.root === root && t.relPath.endsWith(".md")),
          path.dirname(config.file),
        ),
      );
    }
  }

  return aggregate(invocations, config.exemptions, opts.failOn ?? "error");
}

function narrowTargets(
  targets: Target[],
  paths: string[] | undefined,
  cwd: string,
): Target[] {
  if (!paths || paths.length === 0) return targets;
  const absPaths = paths.map((p) => path.resolve(cwd, p));
  return targets.filter((t) =>
    absPaths.some((p) => t.absPath === p || t.absPath.startsWith(p + path.sep)),
  );
}

async function runInstance(
  rule: RuleDescriptor<unknown>,
  canonicalType: string,
  entry: ResolvedRuleEntry,
  options: unknown,
  root: TargetRoot,
  rootTargets: readonly Target[],
  services: Services,
): Promise<InvocationResult> {
  const matches = scopeMatcher(entry.include, entry.exclude);
  const matched = rootTargets.filter((t) => matches(t.relPath));
  const severity = entry.severity ?? rule.meta.defaultSeverity;

  const findings: Finding[] = [];
  const notes: Note[] = [];
  let skippedReason: string | undefined;
  let naReason: string | undefined;

  const ctx: RuleContext = {
    instanceId: entry.id,
    options,
    targets: matched,
    root,
    services,
    readText: (t) => services.fs.readText(t.absPath),
    readDoc: async (t, format: DocFormat) =>
      parseStructured(t.relPath, await services.fs.readText(t.absPath), format),
    stat: (t) => services.fs.stat(t.absPath),
    report: (input: ReportInput) => {
      findings.push({
        ruleId: entry.id,
        ruleType: canonicalType,
        severity: input.severity ?? severity,
        kind: input.kind,
        message: input.message,
        locator: input.locator,
        remediation: input.remediation ?? rule.meta.remediation,
        ...(input.expected !== undefined ? { expected: input.expected } : {}),
        ...(input.found !== undefined ? { found: input.found } : {}),
        ...(input.repairHint !== undefined ? { repairHint: input.repairHint } : {}),
        ...(input.fix !== undefined ? { fix: input.fix } : {}),
        ...(input.sourceRuleId !== undefined ? { sourceRuleId: input.sourceRuleId } : {}),
        ...(input.sourceRuleAliases !== undefined
          ? { sourceRuleAliases: input.sourceRuleAliases }
          : {}),
      });
    },
    note: (message, locator) => {
      notes.push({ message, ruleId: entry.id, ...(locator ? { locator } : {}) });
    },
    markSkipped: (reason) => {
      skippedReason = reason;
    },
    markNotApplicable: (reason) => {
      naReason = reason;
    },
  };

  try {
    await rule.check(ctx);
  } catch (e) {
    if (e instanceof DocParseError) {
      // Target content the rule asked for is malformed: always a deterministic
      // ERROR — the content is the thing under test, never an observability gap.
      findings.push({
        ruleId: entry.id,
        ruleType: canonicalType,
        severity: "error",
        kind: "parse-error",
        message: `cannot parse target: ${e.message}`,
        locator: { file: e.file, ...(e.line !== undefined ? { line: e.line } : {}) },
        remediation: "Fix the file's syntax; the rule cannot evaluate malformed content.",
      });
    } else if (e instanceof UnavailableError) {
      if (rule.meta.onUnobservable === "skipped") {
        skippedReason = `capability unavailable: ${e.capability}`;
      } else {
        findings.push({
          ruleId: entry.id,
          ruleType: canonicalType,
          severity: "error",
          kind: "unobservable",
          message: `required capability unavailable: ${e.capability}`,
          locator: { file: "." },
          remediation:
            "Make the capability available, or declare the rule fail-open (onUnobservable: skipped).",
        });
      }
    } else {
      // A rule crash must never kill the run: surface it via the rule's
      // observability contract plus an internal-error note.
      notes.push({
        message: `internal error in ${entry.id}: ${(e as Error).stack ?? String(e)}`,
        ruleId: entry.id,
      });
      if (rule.meta.onUnobservable === "skipped") {
        skippedReason = `rule crashed: ${(e as Error).message}`;
      } else {
        findings.push({
          ruleId: entry.id,
          ruleType: canonicalType,
          severity: "error",
          kind: "unobservable",
          message: `rule implementation crashed: ${(e as Error).message}`,
          locator: { file: "." },
          remediation: "This is a bug in the rule implementation — report it upstream.",
        });
      }
    }
  }

  return {
    ruleId: entry.id,
    ruleType: canonicalType,
    findings,
    notes,
    targetsMatched: matched.length,
    onEmpty: entry.onEmpty,
    remediation: rule.meta.remediation,
    ...(skippedReason !== undefined ? { skippedReason } : {}),
    ...(naReason !== undefined ? { naReason } : {}),
  };
}

/** Testing seam used by the published fixture harness (`xlinter/testing`). */
export async function runInstanceForTesting(
  rule: RuleDescriptor<unknown>,
  entry: ResolvedRuleEntry,
  options: unknown,
  root: TargetRoot,
  targets: readonly Target[],
  services: Services,
): Promise<InvocationResult> {
  return runInstance(rule, rule.type, entry, options, root, targets, services);
}

export type { RunResult } from "./aggregate.js";
