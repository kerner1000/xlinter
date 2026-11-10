# xlinter — agent brief

Public npm package (`xlinter`), Apache-2.0. TypeScript, ESM-only, Node >= 22, strict tsconfig
(`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Plain `tsc` build to `dist/`, vitest
for tests, zod 4 for config validation, `yaml` for parsing, `markdownlint` exact-pinned.

## Invariants

- **The engine contains zero consumer-specific policy.** Policy lives in consumer configs and
  preset packages. If a change encodes one user's convention into engine code, it is wrong.
- **Stable public surface**: rule type IDs, config keys, finding fields, the JSON envelope
  (`schemaVersion`), and exit codes (0 clean / 1 findings / 2 config or usage error / 3 internal)
  are compatibility surfaces — breaking them is a semver-major event.
- **Fixture-first**: every rule type ships `fixtures/valid/**` and `fixtures/invalid/**` cases;
  `test/fixtures.test.ts` fails any registered rule missing either kind. New rule = new fixtures
  in the same change.
- **One doc page per rule** under `docs/rules/<type>.md`; `xlinter rules --check-docs` and the
  dogfood config enforce presence, naming, frontmatter, and index membership.
- **Findings carry remediation**: `report()` without an actionable message or the rule's default
  remediation is a defect, not a style issue.
- `process.exit` only in `src/cli/main.ts`; the engine is a pure library (`lintProject`).

## Working here

- Build: `npm run build` (empties `dist/` first, because `tsc` keeps output whose source is gone).
  Tests: `npm test`. Self-lint: `npm run lint:self` (must stay clean). Everything CI runs:
  `npm run verify`.
- Regenerate the published config schema after changing config or rule option schemas:
  `npm run schema` (CI fails on a stale `schema/xlinter-config.schema.json`).
- Selector grammar is deliberately small: `$`, `.name`, `['name']`, `[index]`, `[*]`, and the
  RFC 9535 filter subset `[?@.field]` / `[?@.field == 'lit']` / `!=` / `&&` (max two path
  members, number or quoted-string literals). Recursive descent, slices, unions, `||`,
  ordering comparisons, and functions are reserved or rejected with explicit errors — do not
  "helpfully" extend the grammar ad hoc.
- Conventional Commits.

## Releasing

A published version number can never be reused, so a release comes from a workflow and not from a
checkout. Pushing tag `v<version>` runs `.github/workflows/release.yml`, which stages the package on npm
through trusted publishing, with no long-lived token. Nothing is public until a maintainer approves it
with 2FA, and the published version carries a provenance attestation naming the commit.

The `build` job runs `npm run prepublishOnly`. `scripts/check-publish-source.mjs` refuses anything but a
checkout with no local changes at the commit tag `v<version>` names, with that commit on `main`, both in
the repository `repository.url` declares. `npm run verify` then rebuilds `dist/` from empty and runs every
CI check, and the source check runs again. Only the `publish` job can get an OIDC token for npm, and it
only stages the tarball `build` packed; npm runs no scripts for a tarball. The `release-workflow` self-lint
rule pins that split, because CI never runs this workflow.

The `package-contract` self-lint rule requires the package identity, license, module type, Node minimum,
repository URL, and release-gate scripts. It pins the exact `files` array; the packlist test separately
checks what npm actually packs. It forbids `prepack`, `prepare`, `postpack`, `publish`, and `postpublish`,
which run after `prepublishOnly`'s final source check. Intentional packaging or lifecycle changes must
update `.xlinter.yaml` in the same PR. Version and descriptive metadata remain free to change.

The trusted publisher on npmjs.com names `kerner1000/xlinter` and `release.yml`, with no environment, and
allows `npm stage publish` only. Renaming the workflow file stops releases until the publisher is
recreated. A new publisher expires unless its first publish succeeds within 2 days.

1. Merge the version bump to `main` and wait for CI.
2. Tag that commit:

   ```bash
   git fetch origin main
   git push origin <sha>:refs/tags/v<version>
   ```

3. Wait for the `release` workflow. If `build` refuses the source, nothing reached npm. Delete a wrong tag
   with `git push origin :refs/tags/v<version>` and tag the right commit. If `publish` fails with
   `ENEEDAUTH`, npm got no OIDC token and nothing reached npm: check the trusted publisher on npmjs.com,
   then rerun only that job with `gh run rerun <run-id> --failed`. It reuses the tarball `build` packed,
   which is kept for 7 days.
4. Run `npm stage list xlinter`, then `npm stage download <stage-id>` and check what it would ship. If
   `download` returns `E401`, the `publish` job log lists the tarball contents and shasum.
5. Run `npm stage approve <stage-id>`, or `npm stage reject <stage-id>` if it is wrong. Approval asks for a
   browser login with 2FA, and `E409` "automated review hasn't finished" means retry in a few minutes.
   Every staged version carries tag `latest` and approving it moves `latest`, so approve in version order.
6. Check that the provenance names the tag and commit. The registry can take a few minutes to show the
   new version.

   ```bash
   curl -fsS https://registry.npmjs.org/-/npm/v1/attestations/xlinter@<version> \
     | jq -r '.attestations[] | select(.predicateType == "https://slsa.dev/provenance/v1")
       | .bundle.dsseEnvelope.payload | @base64d | fromjson | .predicate.buildDefinition
       | [.externalParameters.workflow.ref, .resolvedDependencies[0].digest.gitCommit] | @tsv'
   ```

Only `main` can be released; a maintenance branch would need a change to the gate. The workflow's tag
filter does not match pre-release versions.

If the workflow cannot run, publish from a fresh detached worktree of the tag: `npm ci`, then
`npm publish --dry-run`, whose output must include the `publish source OK` line twice, then `npm publish`,
which prompts for 2FA and produces no attestation. `prepublishOnly` applies the same gate there, and it
does not look at `node_modules`, which is why this starts with `npm ci`.

The gate does not compare the version with what the commit contains. A breaking change needs its version
bump before any tag, and an older commit on `main` can still be tagged with the version it declares.

The gate catches mistakes rather than deliberate bypasses. `--ignore-scripts`, `ignore-scripts=true` in an
npm config, and publishing a prebuilt tarball all skip it locally without any message, so do not publish
that way. Check `npm config get ignore-scripts` if the dry run does not show the `publish source OK` line.
Local Git config such as `core.worktree` or `url.*.insteadOf` can mislead it.
