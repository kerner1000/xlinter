# 2026-11-06 - Invalid CLI arguments exit 2

## Retrospective

**Scope:** xlinter, branch `fix/2026-11-06-cli-invalid-args`, session worktree
`/Users/alex/sources/xlinter.worktrees/sleepy-dubinsky-19a648`. No tracked issue preceded the change.
The canonical checkout retained its pre-existing untracked `.idea/` directory.

**Done:** [PR #19](https://github.com/kerner1000/xlinter/pull/19) makes invalid command-line arguments
exit 2 with one `config error:` line, or the `configErrors` envelope under `--format json`. They used
to exit 3 with a stack trace. Commit `cc4eb84d0409461c3db1b1a0d73cc43660b917db` passed `npm run verify`
with 306 tests, self-lint, rule documentation checks, and schema freshness, and CI passed on Node 22
and 24. The README and `AGENTS.md` now describe exit 2 as "config or usage error".

**Decided:** Exit 2 through the existing `XlinterConfigError`, with no new exit code and no new label.
`src/cli/main.ts` and `src/config/types.ts` already defined exit 2 as config or usage, and `--format xml`,
`--fail-on never`, `explain` with no id, and `explain no-such-rule` already use it. A separate code would
add a compatibility surface and split one class of error. Only `ERR_PARSE_ARGS_*` is mapped, so any
other error from `parseArgs` stays exit 3. Node's message text is passed through with newlines folded
rather than parsed, because Node owns that wording. The change is not semver-major: exit 3 was never
documented for a bad flag.

**Discovered:** `process.argv.includes("json")` misreads the format in both directions
([#16](https://github.com/kerner1000/xlinter/issues/16)). A nonexistent lint path or mistyped subcommand
is treated as a path filter, and the exit code then depends on the config
([#17](https://github.com/kerner1000/xlinter/issues/17)). Node's ambiguous-value message spans three
lines, and its unknown-option message ends with an unbalanced quote.

**Open items:** PR #19 remains open for operator merge. Issues #16 and #17 are filed and unstarted; #17
needs a compatibility decision because it would turn an exit 0 into an exit 2.

**How it went:** A failing-first run confirmed exit 3 on all nine new cases before the fix. Probing the
mistyped subcommand corrected an assumed exit 0 before it reached #17: on this repository's own config
the run exits 1 with an unrelated index finding.
