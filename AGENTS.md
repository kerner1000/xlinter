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

- Build: `npm run build`. Tests: `npm test`. Self-lint: `npm run lint:self` (must stay clean).
- Regenerate the published config schema after changing config or rule option schemas:
  `npm run schema` (CI fails on a stale `schema/xlinter-config.schema.json`).
- Selector grammar is deliberately minimal (`$`, `.name`, `['name']`, `[index]`, `[*]`); filter,
  descent, slice, and union tokens are reserved with explicit errors — do not "helpfully"
  implement them ad hoc.
- Conventional Commits.
