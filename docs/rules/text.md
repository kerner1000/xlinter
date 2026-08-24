---
ruleId: text
defaultSeverity: error
---

# text

## Summary

Dumb literal containment over plain text: `require` literals must appear somewhere in the file,
`forbid` literals must not. No boundaries, no parsing, no cleverness — reach for
[forbidden-tokens](forbidden-tokens.md) when you need boundary semantics or allowed-form
stripping.

## Why

Some contracts are exactly "this file still says that": a runbook keeps its section headings, a
README keeps its install command. A literal check states the contract verbatim and cannot
misfire on syntax it does not try to understand.

## Options

| Option    | Type    | Default | Description                                      |
| --------- | ------- | ------- | ------------------------------------------------ |
| `require` | `array` | `[]`    | Literals that must appear in every matched file. |
| `forbid`  | `array` | `[]`    | Literals that must not appear.                   |

At least one of the two must be non-empty. A missing `require` literal is an `absence` finding
(exemptable by design — right for documents in transition); a present `forbid` literal is a
`forbidden` finding carrying the line of its first occurrence.

## Examples

```yaml
rules:
  runbook-sections:
    type: text
    targets: { include: ["apps/docflow/RUNBOOK.md"] }
    require:
      - "## Dead extraction rows"
      - "## Lane saturation"
```

Renaming a heading fails with `required text "## Lane saturation" not found`.

## Remediation

Add the missing required text, or remove the forbidden text — the finding names the exact
literal. If a heading legitimately moved, update the instance's `require` list in the same
change that moves it.
