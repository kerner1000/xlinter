# 2026-11-10 - Trusted publishing rollout

## Release workflow (issue #9)

**Done:** PR #13 added `.github/workflows/release.yml`, the tag rule in `scripts/check-publish-source.mjs`,
the `release-workflow` self-lint rule, and the tag-driven steps in `AGENTS.md`. PR #14 bumped the version
to 0.3.1. The design, its evidence, and its verification are in the PR #13 description.

**Resolved by the releases:** PR #13 left three points that only a real release could test. The `publish`
job and its OIDC exchange work, after the rerun described in the 2026-11-10 release entry. Staged
versions keep their provenance: 0.3.1 and 0.4.0 both carry a SLSA v1 attestation, per the #9 closing
comment. Whether a rejected version can be staged again is still unknown, because nothing has been
rejected.

**Not done:** The last rollout step, "Require two-factor authentication and disallow tokens" on npmjs.com
followed by revoking unneeded tokens, was never applied or checked. #28 tracks it.

## zod advisory (PR #15)

**Done:** The zod floor moved from `^4.4.3` to `^4.6.7` for GHSA-mrhx-c7xc-m3w5.

**Discovered:** The zod 4.6.6 fix checks array, set and map size bounds before parsing elements, so it
helps only schemas with a size bound. No xlinter schema sets one, and through the CLI the YAML parser
runs out of memory first: at 1,000,000 elements in a 256 MB heap, parsing alone fails. The upgrade
clears the audit report and does not change how xlinter handles an oversized config. No bounds were
added, because zod validates only the config, rule options and test harness cases, and a config can
already run code through `plugins`. The measurements are in the PR #15 description.

**Consequence:** `v0.3.1` names `7e7fafa`, which predates PR #15, so 0.3.1 declares zod `^4.4.3`. 0.4.0
declares `^4.6.7`.

## Version 0.4.0 bump

**Done:** Two identical 0.4.0 bump PRs were opened from separate branches: #24 on `39fff29`, before
PR #23 merged, and #25 on `bb7cf6e`, with a journal entry. #24 was closed as superseded by #25. Its
worktree and branches were removed after its head `c393195` was confirmed in `refs/pull/24/head`.

## Retrospective

**Scope:** xlinter. Canonical checkout `/Users/alex/sources/xlinter`; worktrees `trusted-publishing`
(PR #13), `release-v0.3.1` (PR #14), `zod-advisory` (PR #15), `release-v0.4.0` (PR #24, removed), and
`journal-trusted-publishing` for this entry.

**Done:** PRs #13, #14 and #15 merged. PR #24 closed as a duplicate of #25. #28 filed.

**Decided:** Releases come from a tag-triggered workflow with a staged publish and a 2FA approval
(PR #13). The zod floor was raised without adding schema bounds (PR #15). The breaking change from PR #22
ships as 0.4.0.

**Discovered:** npm reads `<root>/.git/HEAD` as a path when it records `gitHead`, which fails silently in
a linked worktree; tarball publishes carry no `gitHead` at all, so the tag and the attestation record
the commit. The zod fix only covers bounded schemas.

**Open items:**

- #28: disallow token publishes on npmjs.com.
- #8 is at `stage:review`. Both release builds ran `prepublishOnly` and passed, which is the publish
  hook its acceptance names.
- #27: move the release procedure out of `AGENTS.md`.
- Whether a rejected staged version can be staged again.

**How it went:** Merges from parallel branches changed the release plan twice: PR #22 merged while
`main` still declared 0.3.1, and two 0.4.0 bump PRs were opened. Reading `main` and the open PRs right
before each release step caught both before a tag was pushed.
