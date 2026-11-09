# 2026-11-06 - Error output follows the parsed --format value

## Retrospective

**Scope:** xlinter, branch `fix/2026-11-06-format-json-errors`, session worktree
`/Users/alex/sources/xlinter.worktrees/sharp-knuth-af0eee`, based on `main` at `7e7fafa`, which carries
[PR #19](https://github.com/kerner1000/xlinter/pull/19). Issue
[#16](https://github.com/kerner1000/xlinter/issues/16).

**Done:** Commit `60c57a3` makes the rejection handler in `src/cli/main.ts` read `--format` through a
second `parseArgs` with `strict: false` over one shared `CLI_OPTIONS` table, replacing
`process.argv.includes("json")`. It adds 17 integration cases. `npm run verify` passed with 323 tests,
self-lint, the doc check, and schema freshness. The built CLI reports `--format=json --fail-on never` as
the `configErrors` envelope and `--config json` as one line on stderr, both exit 2.

**Decided:** A lenient re-parse rather than scanning argv or tokens, because a second hand-written
reading is the defect class being removed. `--config --format json` reports in human format: Node reads
`--format` as the value of `--config` and rejects that as ambiguous, so either reading is a guess. The
failure stays exit 2 with a message on stderr, and in 0.3.0 that shape exited 3 with empty stdout, so no
released caller loses an envelope. No `try/catch` around the lenient parse, because it is reached only
for `XlinterConfigError`, which means the option table already validated. The change is not
semver-major: exit codes, envelope shape, and `schemaVersion` do not change, only the channel for exit-2
errors. The fix depends on #19, because only with it does a `parseArgs` failure reach this handler. The
work started on #19's head, and #19 merged before publication, so the branch was rebased onto `main`.

**Discovered:** A read-only probe on Node 24.18 over every argument vector up to length 4 from 19 tokens
(137,561 vectors) found that the lenient parse never threw, never disagreed with the strict parse where
strict accepted, and that every strict rejection was `ERR_PARSE_ARGS_*`. The old check differed from the
new one on 36,835 vectors. The probe did not run on Node 22; the integration tests in CI are the Node 22
evidence. The old check matched exact tokens only, so `--config=json` already reported the human line
before the fix.

**Open items:** The PR awaits operator merge.

**How it went:** The failing-first run gave 11 failed and 6 passed and contradicted two predictions:
`--config --format json` failed before the fix (predicted pass), and `--config=json` passed before the
fix (predicted fail). Both trace to the exact-token match of the old check, not to the tests or the
design. The `--config=json` case stays as a guard against a substring fix but is not failing-first
evidence.
