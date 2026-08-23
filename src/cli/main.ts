#!/usr/bin/env node
/**
 * CLI entry. process.exit lives ONLY in this file — the engine is a pure
 * library so other hosts (tests, a future MCP server) never touch exit codes.
 *
 * Exit contract:
 *   0  no error findings (warn/note/na/skipped allowed)
 *   1  at least one error finding (or warn with --fail-on warn)
 *   2  config or usage error
 *   3  internal crash (a bug in xlinter)
 */
import { parseArgs } from "node:util";
import { XlinterConfigError } from "../config/types.js";
import { formatConfigErrorsJson } from "./formats/json.js";
import { runLint } from "./commands/lint.js";
import { runExplain } from "./commands/explain.js";
import { runRules } from "./commands/rules.js";
import { runValidateConfig } from "./commands/validate-config.js";

const SUBCOMMANDS = new Set(["explain", "rules", "validate-config"]);

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const sub = argv[0] !== undefined && SUBCOMMANDS.has(argv[0]) ? argv[0] : "lint";
  const rest = sub === "lint" ? argv : argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      format: { type: "string", default: "human" },
      "fail-on": { type: "string", default: "error" },
      rules: { type: "string" },
      "list-targets": { type: "boolean", default: false },
      "check-docs": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (values.format !== "human" && values.format !== "json") {
    throw XlinterConfigError.single(`unknown --format "${values.format}" (human|json)`);
  }
  if (values["fail-on"] !== "error" && values["fail-on"] !== "warn") {
    throw XlinterConfigError.single(`unknown --fail-on "${values["fail-on"]}" (error|warn)`);
  }

  const common = {
    format: values.format as "human" | "json",
    configFile: values.config,
  };

  switch (sub) {
    case "explain":
      return runExplain(positionals, common);
    case "rules":
      return runRules({ ...common, checkDocs: values["check-docs"] });
    case "validate-config":
      return runValidateConfig(positionals, common);
    default:
      return runLint(positionals, {
        ...common,
        failOn: values["fail-on"] as "error" | "warn",
        rulesFilter: values.rules?.split(",").map((s) => s.trim()),
        listTargets: values["list-targets"],
      });
  }
}

const USAGE = `xlinter — agent-first repository-policy linter

Usage:
  xlinter [paths...]            lint (default command)
    --config <file>             explicit config (default: nearest .xlinter.yaml)
    --format human|json         output format (json is the agent surface)
    --fail-on error|warn        what fails the run (default error)
    --rules <id,id>             run only these rule instances
    --list-targets              print resolved targets and exit
  xlinter explain <id>          print a rule type's, instance's, or adapter rule's docs
  xlinter rules [--check-docs]  list rule types (--check-docs verifies doc pages)
  xlinter validate-config [f]   schema-check a config; exit 0/2
`;

main().then(
  (code) => process.exit(code),
  (err) => {
    if (err instanceof XlinterConfigError) {
      const wantJson = process.argv.includes("json");
      if (wantJson) {
        process.stdout.write(formatConfigErrorsJson(err.details) + "\n");
      } else {
        for (const d of err.details) {
          const where = [d.file, d.path].filter(Boolean).join(" ");
          process.stderr.write(`config error: ${d.message}${where ? ` (${where})` : ""}\n`);
        }
      }
      process.exit(2);
    }
    process.stderr.write(`internal error: ${(err as Error).stack ?? String(err)}\n`);
    process.exit(3);
  },
);
