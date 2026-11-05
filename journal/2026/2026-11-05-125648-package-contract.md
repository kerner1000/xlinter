# 2026-11-05 - Package contract safeguards

## Retrospective

**Scope:** xlinter issue [#11](https://github.com/kerner1000/xlinter/issues/11), branch
`fix/2026-11-05-package-contract`, isolated worktree
`/Users/alex/sources/xlinter.worktrees/issue-11-package-contract`. The canonical checkout retained its
pre-existing untracked `.idea/` directory; the earlier PR #10 review worktree was read only.

**Done:** [PR #12](https://github.com/kerner1000/xlinter/pull/12) adds package-policy safeguards and
regression coverage. Commit `15e559778807090c4199fbeab8366b64aafa0623` passed `npm run verify`: 274
tests, self-lint, rule documentation checks, and schema freshness. CI passed on Node 22 and 24, and an
independent review found no blockers. The 167 packed files and tarball integrity matched the base.

**Decided:** Pin the intended file allowlist in repository policy while retaining the packlist test
as a check of actual npm output. Keep this package's conventions out of the engine. Packaging and
publish-lifecycle changes require a deliberate policy update; version and descriptive metadata remain
free to change. No dependency, public schema, release version, or packaged-content change was needed.

**Discovered:** Equality assertions alone do not reject absent fields. Packlist consistency does not
establish that the intended directories are present. The original policy accepted all reported edits;
22 regression cases failed before the fix while 17 existing checks and positive controls passed.

**Open items:** PR #12 remains open for operator merge, with issue #11 at `stage:review`. No further
deployment or publishing acceptance is required for this repository-policy fix.

**How it went:** Testing mutations against the real repository configuration established that the
checks reached the defects. Positive controls preserved ordinary metadata edits, and the package
comparison confirmed that the policy changes did not alter the published artifact.
