# Rule reference

One page per builtin rule type; each page documents the rule's options, an example configuration
with a violating input, and how to remediate its findings.

- [file-name](file-name.md) — every matched file's basename satisfies a naming pattern.
- [file-pairing](file-pairing.md) — sibling files must co-exist (e.g. `AGENTS.md` ⇄ `CLAUDE.md`).
- [first-heading](first-heading.md) — the first H1 of every matched markdown file matches a pattern.
- [index-completeness](index-completeness.md) — an index file and its directory's contents stay a
  bidirectional map.
- [nodes](nodes.md) — structured-document nodes satisfy scalar assertions (YAML/JSON/frontmatter).

Adapters that wrap external linters are documented separately — see the
[markdownlint adapter](../adapters/markdownlint.md).
