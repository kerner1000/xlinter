# Rule reference

One page per builtin rule type; each page documents the rule's options, an example configuration
with a violating input, and how to remediate its findings.

- [cross-file](cross-file.md) — a value in one file agrees (eq/contains/memberOf) with a value
  declared in another.
- [file-name](file-name.md) — every matched file's basename satisfies a naming pattern.
- [file-pairing](file-pairing.md) — sibling files must co-exist (e.g. `AGENTS.md` ⇄ `CLAUDE.md`).
- [first-heading](first-heading.md) — the first H1 of every matched markdown file matches a pattern.
- [forbidden-tokens](forbidden-tokens.md) — forbidden tokens must not appear, with boundary
  semantics and allowed-form stripping.
- [index-completeness](index-completeness.md) — an index file and its directory's contents stay a
  bidirectional map.
- [node-table](node-table.md) — keyed expectation table: values bound to the node that owns the
  key.
- [nodes](nodes.md) — structured-document nodes satisfy scalar assertions (YAML/JSON/frontmatter).
- [text](text.md) — plain-text files contain required literals and avoid forbidden ones.

Adapters that wrap external linters are documented separately — see the
[markdownlint adapter](../adapters/markdownlint.md).
