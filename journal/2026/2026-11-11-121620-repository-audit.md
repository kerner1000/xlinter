# 2026-11-11 - Repository audit

## Audit

The whole repository was read at `4130468` (0.4.0): source, tests, fixtures, docs, config, workflows and
journal. `npm run verify` passed there with 340 tests, so none of the defects below is visible to CI. Each
suspected defect was run against the built CLI on a throwaway fixture before it was written down, and the
transcripts in the issues are that output.

## Issues

43 issues were filed, [#30](https://github.com/kerner1000/xlinter/issues/30) to
[#71](https://github.com/kerner1000/xlinter/issues/71) and
[#73](https://github.com/kerner1000/xlinter/issues/73): 31 bugs (7 `sev:medium`, 24 `sev:low`), 10
maintenance items and 2 decisions, all at `stage:triage`. The label validator passed for every open issue.

The medium bugs are the ones that give a wrong verdict or break a documented use:

- #30: path arguments make `index-completeness`, `cross-file` and the exemption audit fail falsely.
- #32: defaults of a child config override values its parent set.
- #33: `order` compares mapping keys alphabetically.
- #34: `forbidden-tokens` with `parse` and `select` misses a token after a newline.
- #38: a plugin rule type is reachable only through an alias that repeats its name.
- #40: `validate-config` accepts unknown rule types and invalid options.
- #58: the markdownlint adapter ignores `extends` in the upstream config.

Issues #20 and #21 were already open and still reproduce.

## Example address

[PR #72](https://github.com/kerner1000/xlinter/pull/72) replaces a routable IPv4 address in the `nodes`
decode fixtures and in one comment of `src/rules/shared/asserts.ts` with an RFC 5737 documentation
address. Git history and the published packages were left as they are. #73 tracks the product-specific
names that remain in three rule pages and 17 fixture files.

## Retrospective

**Scope:** xlinter. Canonical checkout `/Users/alex/sources/xlinter` on `main`, read only. Worktree
`/Users/alex/sources/xlinter.worktrees/fixture-documentation-address` on
`test/2026-11-11-fixture-documentation-address` for PR #72 and this entry.

**Done:** The audit, 43 issues, and PR #72 with commit `4fab301`. `npm run verify` passed on the branch.

**Decided:** One issue per defect, as #20 and #21 already are. Severity follows whether a result is wrong
without a message (medium) or the failure is loud or has a workaround (low). Parts of an issue that rest
on reading the code and were not run say so. The 11 branches of merged pull requests that remain on
`origin` and the stage of #8 were left alone.

**Discovered:** The fixture-first rule asks for one valid and one invalid case per rule type, which left
whole options without a test (#66); `order` between mapping keys is one of them. The merge test for
`extends` builds its layers without the schema, so it cannot see #32. `npm pack` ignores `--prefix` and
packs the current directory: the first package measurement came from a build of 25 August in another
checkout, and #68 has the figures of a fresh build (167 files, 458 kB, 76 maps). Issue prose has to use
ASCII punctuation; nine bodies were corrected after filing.

**Open items:**

- PR #72 awaits merge.
- The 43 issues await triage. A workable order is #30, #32 and #31 first, then #33 and #34, then #40
  together with #41.

**How it went:** Running every suspected defect before reporting it removed several that only looked
wrong in the source, and settled what was merely slow: parsing is 92% of a lint pass, selector parsing
is not measurable (#67). Generating each issue's transcript by running its files caught the stale package
figures before they were filed.
