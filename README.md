# xlinter

An **agent-first repository-policy linter**: it checks the *structure* of a repository — file
naming, required pairings, document frontmatter, index completeness, structured-file invariants —
rather than the code inside it. Its home niche is the **agent workspace**: repositories that carry
`AGENTS.md`/`CLAUDE.md` instruction files, skills, and machine-readable policy that today nothing
lints.

xlinter orchestrates established linters instead of reimplementing them (markdownlint ships as the
first adapter) and adds the repository-policy layer they don't model.

## Why another linter

- Repository-*policy* linting has no maintained incumbent (Repolinter is archived).
- Agent workspaces have real, checkable invariants — instruction files that must pair, budgets
  that must hold, docs that must stay indexed — currently enforced by ad-hoc shell.
- Agents are first-class users: stable rule IDs, machine-readable JSON output, per-finding
  remediation text, a published config JSON Schema, and one doc page per rule that
  `xlinter explain <rule>` prints.

## Install / run

```bash
npm install -D xlinter
npx xlinter .
```

Requires Node >= 22.

## Configuration

`.xlinter.yaml` at the repository root. Rule *types* are engine code; your config instantiates
them as named rule *instances*:

```yaml
version: 1
namespace: myrepo
rules:
  adr-frontmatter:
    type: nodes
    targets: { include: ["docs/decisions/*.md"] }
    parse: frontmatter
    select: "$"
    assert:
      - path: "$.status"
        required: true
        enum: [Proposed, Accepted, Rejected]
  agent-files:
    type: file-pairing
    left: AGENTS.md
    right: CLAUDE.md
adapters:
  markdownlint:
    config: .markdownlint.yaml
```

Shared policy is distributed as a preset package consumed via `extends`. A `./` or `../` entry is
relative to the config file that declares it. A bare name (`extends: ["@acme/preset"]`) resolves the
package's exported `./xlinter.yaml` from the declaring file's location with Node's `import`, `node`,
and `default` export conditions, so it also works from a global or `npx` install. Node's `--conditions`
flag is not consulted: publish variants as subpath exports and select them explicitly
(`extends: ["@acme/preset/strict"]` resolves `./strict/xlinter.yaml`). The full config schema is
published as `xlinter/schema.json`.

## Rule types (M1)

| type | invariant |
| --- | --- |
| `file-name` | basenames match a pattern, with an allow-list |
| `file-pairing` | sibling files must co-exist (e.g. `AGENTS.md` ⇄ `CLAUDE.md`) |
| `first-heading` | first H1 matches a pattern (`${stem}` substitution) |
| `index-completeness` | an index file and its directory stay bidirectionally complete |
| `nodes` | structured-file assertions over YAML / JSON / frontmatter via JSONPath selection |

Plus the `markdownlint` adapter (exact-pinned upstream, config passthrough, findings normalized
into xlinter's output with severity overrides per upstream rule).

## Agent-first surface

- `xlinter --format json` — versioned envelope, config errors included.
- `xlinter explain <ruleId>` — the rule's doc page, offline.
- `xlinter rules` / `xlinter validate-config` — discovery and self-validation for config authors.
- Exit codes: `0` clean, `1` findings, `2` config error, `3` internal error.
- Every finding: stable `ruleId` + `ruleType`, `kind`, locator (file/line/docPath), `expected` /
  `found`, and a remediation sentence an agent can act on.
- Exemptions are ratcheted: an exemption that suppressed nothing this run is itself an error —
  the list can only shrink.

## Status

Early (M1 bootstrap). The engine, five rule types, the markdownlint adapter, and the fixture
harness are real and dogfooded on this repository (see [.xlinter.yaml](.xlinter.yaml)). Planned:
agent-workspace rule library, per-node expectation tables for structured policy, MCP server mode,
GitHub Action packaging, SARIF.

## License

Apache-2.0.
