# xlinter — agent brief

Public npm package (`xlinter`), Apache-2.0. TypeScript, ESM-only, Node >= 22, strict tsconfig
(`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`). Plain `tsc` build to `dist/`, vitest
for tests, zod 4 for config validation, `yaml` for parsing, `markdownlint` exact-pinned.

## Invariants

- **The engine contains zero consumer-specific policy.** Policy lives in consumer configs and
  preset packages. If a change encodes one user's convention into engine code, it is wrong.
- **Stable public surface**: rule type IDs, config keys, finding fields, the JSON envelope
  (`schemaVersion`), and exit codes (0 clean / 1 findings / 2 config error / 3 internal) are
  compatibility surfaces — breaking them is a semver-major event.
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

`npm publish` packs the working tree, so the checkout is the release, and a published version number
can never be reused. `prepublishOnly` guards both the source and the build:
`scripts/check-publish-source.mjs` refuses anything but a checkout with no local changes at the current
tip of `main` in the repository `repository.url` declares, `npm run verify` rebuilds `dist/` from empty
and runs every CI check, then the source check runs again. It does not look at `node_modules`, which
is why step 3 starts with `npm ci`. Only `main` can be released; publishing from a maintenance branch
would need a change to this gate. The gate catches mistakes rather than deliberate bypasses: local Git
config such as `core.worktree` or `url.*.insteadOf` can mislead it.

The `package-contract` self-lint rule requires the package identity, license, module type, Node minimum,
repository URL, and release-gate scripts. It pins the exact `files` array; the packlist test separately
checks what npm actually packs. It forbids `prepack`, `prepare`, `postpack`, `publish`, and `postpublish`,
which run after `prepublishOnly`'s final source check. Intentional packaging or lifecycle changes must
update `.xlinter.yaml` in the same PR. Version and descriptive metadata remain free to change.

1. Merge the version bump to `main` and wait for CI.
2. From the canonical checkout, create a fresh detached worktree:

   ```bash
   git fetch origin main
   git worktree add --detach ../xlinter.worktrees/release-<version> origin/main
   ```

3. In that worktree run `npm ci`, then `npm publish --dry-run`. Its output must include the
   `publish source OK` line twice, and the file list must be what you expect to ship.
4. Run `npm publish`.
5. Run `npm view xlinter version`. The registry can take a few minutes to show the new version.
6. Remove the worktree.

`--ignore-scripts`, `ignore-scripts=true` in an npm config, and publishing a prebuilt tarball all skip
this gate without any message. Do not publish that way. Check `npm config get ignore-scripts` if the
dry run does not show the `publish source OK` line.
