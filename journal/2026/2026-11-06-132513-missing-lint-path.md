# 2026-11-06 - Missing lint path exits 2

## Retrospective

**Scope:** xlinter, issue [#17](https://github.com/kerner1000/xlinter/issues/17), branch
`fix/2026-11-06-missing-lint-path`, session worktree
`/Users/alex/sources/xlinter.worktrees/vigorous-banach-43ea88`.

**Done:** [PR #22](https://github.com/kerner1000/xlinter/pull/22) reports a lint path that does not exist
as a usage error, including a mistyped subcommand and `--list-targets`. Commit `4a8d0cd` passed
`npm run verify` with 323 tests, self-lint, the rule documentation check, and schema freshness.

**Decided:** Exit 2 through `XlinterConfigError`, because the exit contract already covers usage errors.
The change is breaking and the next release from `main` must be 0.4.0: a run that passes today can fail
after an upgrade, including a legitimate `git diff --name-only` list that names a deleted file. PR #19
was different: it moved one failure to another. 0.4.0 is enough because npm's caret stops at the next
0.x minor, and 1.0.0 would claim a stability the README does not. ESLint listed the same change as breaking in its
5.0.0 migration guide. The check is in `lintProject`, because `paths` is public API and other hosts had
the same silent pass, and it runs before config load. It uses the `lstat`-based `fs.stat` because
`existsSync` is false for a dangling symlink, which is a valid target. No warning phase and no opt-out
flag: a warning leaves the CI typo green, and a flag can be added later without breaking anyone.

**Discovered:** An unknown `--rules` id exits 0 the same way
([#20](https://github.com/kerner1000/xlinter/issues/20)). `--list-targets` ignores paths that exist
([#21](https://github.com/kerner1000/xlinter/issues/21)).

**Open items:** PR #22 remains open for operator merge. Nothing enforces the 0.4.0 version number; only
the `fix!:` commit type, the `BREAKING CHANGE:` footer, and the PR body record it. A 0.3.2 release of
the PR #19 change is possible only if tagged before PR #22 merges.

**How it went:** A failing-first run failed the 11 new error cases and passed the 6 guards, as predicted.
Local consumers all pass `.` and pin an exact version, so they are unaffected; public npm consumers could
not be checked. PR #19 merged between planning and implementation, and this change did not depend on it.
