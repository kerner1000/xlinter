---
ruleId: file-pairing
defaultSeverity: error
---

# file-pairing

## Summary

Checks that two named sibling files co-exist in the same directory: wherever a matched file with the
`left` basename exists, a file with the `right` basename must sit next to it. With `bidirectional`
(the default) the requirement also runs the other way, so the pair can never drift apart.

## Why

Some files only make sense together — `AGENTS.md` next to its `CLAUDE.md` shim, a schema next to its
example, a template next to its config. When one half is added, renamed, or deleted without the
other, every consumer of the missing half silently gets nothing. This rule turns that silent drift
into a finding.

## Options

| Option          | Type      | Default | Description                                                  |
| --------------- | --------- | ------- | ------------------------------------------------------------ |
| `left`          | `string`  | —       | Required. Basename of the anchor file (e.g. `AGENTS.md`).    |
| `right`         | `string`  | —       | Required. Basename that must co-exist in the same directory. |
| `bidirectional` | `boolean` | `true`  | Also require `left` wherever a matched `right` exists.       |

The instance's `targets` patterns decide which files are inspected as anchors; the expected sibling
is then checked on disk directly, so it does not itself need to match the target patterns. For the
bidirectional direction to trigger, files with the `right` basename must be included in `targets`.

## Examples

A minimal `.xlinter.yaml` instance pairing agent instruction files anywhere in the tree:

```yaml
rules:
  agent-files:
    type: file-pairing
    targets: { include: ["AGENTS.md", "CLAUDE.md"] }
    left: AGENTS.md
    right: CLAUDE.md
```

A violating input — `packages/api/AGENTS.md` exists but `packages/api/CLAUDE.md` does not. The rule
reports an `absence` finding on the file that is present:

```text
packages/api/AGENTS.md  error  xlinter/agent-files
  AGENTS.md has no sibling CLAUDE.md
  expected: packages/api/CLAUDE.md   found: missing
```

## Remediation

Create the missing sibling file next to its pair (for `absence` findings the `expected` field names
the exact root-relative path to create). If the pair was intentionally removed, remove both halves
in the same change; if a whole directory is genuinely exempt, exclude it via the instance's
`targets.exclude` patterns.
