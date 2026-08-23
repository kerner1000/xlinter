---
ruleId: index-completeness
defaultSeverity: error
---

# index-completeness

## Summary

Checks that an index file and the files it catalogs stay a bidirectional map: every in-scope file is
linked from the index, and every in-scope link in the index points at a file that exists. Either
direction can be enforced alone via the `direction` option.

## Why

An index (a `README.md`, an `INDEX.md`, a table of contents) is only trustworthy while it is
complete and free of dead links — and both properties rot the moment a file is added or removed
without touching the index in the same change. Enforcing the invariant mechanically makes the index
a reliable map instead of a best-effort snapshot.

## Options

| Option          | Type       | Default  | Description                                                                   |
| --------------- | ---------- | -------- | ----------------------------------------------------------------------------- |
| `index`         | `string`   | —        | Required. Root-relative path of the index file (e.g. `docs/rules/README.md`). |
| `scope.include` | `string[]` | —        | Required (min 1). Which files must be indexed, in gitignore pattern syntax.   |
| `scope.exclude` | `string[]` | `[]`     | Files carved out of the scope, in gitignore pattern syntax.                   |
| `direction`     | `enum`     | `"both"` | `both`, `files-to-index`, or `index-to-files`.                                |

Mechanics:

- The index file must itself be matched by the instance's `targets` patterns; if it is not found
  among them, the rule reports an `absence` finding and stops.
- Markdown links (`[text](path)`) are collected from the index; links with a URL scheme
  (`https:`, `mailto:`, ...) and pure `#anchor` links are ignored, and fragment suffixes are
  stripped. Relative paths resolve from the index file's directory.
- The scope is evaluated over the instance's matched targets; the index file itself is always
  excluded from the scope. Links resolving outside the scope are out of the rule's jurisdiction and
  are never judged.
- `files-to-index` (part of `both`): each scoped file not linked from the index yields an `absence`
  finding on that file. `index-to-files` (part of `both`): each in-scope link whose file does not
  exist yields a `mismatch` finding on the index, at the line of the link's first occurrence.

## Examples

A minimal `.xlinter.yaml` instance keeping this very directory's README complete:

```yaml
rules:
  rule-doc-index:
    type: index-completeness
    targets: { include: ["docs/rules/*.md"] }
    index: docs/rules/README.md
    scope: { include: ["docs/rules/*.md"] }
    direction: both
```

A violating input — `docs/rules/new-rule.md` is added but `docs/rules/README.md` gains no link to
it. The rule reports an `absence` finding on the unlinked file:

```text
docs/rules/new-rule.md  error  xlinter/rule-doc-index
  docs/rules/new-rule.md is not linked from docs/rules/README.md
  expected: a link in docs/rules/README.md   found: no link
```

Deleting a file while its index row stays behind produces the mirror `mismatch` finding on the
index line: `docs/rules/README.md links to docs/rules/old-rule.md, which does not exist`.

## Remediation

Add the missing index row, or remove/fix the dead index link, in the same change as the file
addition, rename, or removal. If a file legitimately does not belong in the index, add it to
`scope.exclude` rather than leaving the invariant broken.
