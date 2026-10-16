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

| Option         | Type    | Default | Description                                      |
| -------------- | ------- | ------- | ------------------------------------------------ |
| `require`      | `array` | `[]`    | Literals that must appear in every matched file. |
| `forbid`       | `array` | `[]`    | Literals that must not appear.                   |
| `requireMatch` | `array` | `[]`    | Patterns of which at least one line must match.  |
| `forbidMatch`  | `array` | `[]`    | Patterns no line may match.                      |

At least one of the four must be non-empty. A missing `require` literal or unmatched
`requireMatch` pattern is an `absence` finding (exemptable by design — right for documents in
transition); a present `forbid` literal or matching `forbidMatch` pattern is a `forbidden` finding
carrying the line of its first occurrence.

Prefer the literal forms. Reach for the pattern forms only where a literal cannot express the
invariant because the rest of the line is legitimately open-ended — a Make target's prerequisite
list, for instance, where pinning the whole line would break the next time a prerequisite is
added. Patterns are matched per line, so `^` and `$` anchor to a line rather than to the file.

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

A pattern where the rest of the line is open-ended:

```yaml
rules:
  cluster-bootstrap-applies-traefik-config:
    type: text
    targets: { include: ["Makefile"] }
    requireMatch:
      - '^apply-cluster-docflow-prod:.*apply-traefik-config-docflow-prod'
```

Dropping the prerequisite fails with
`no line matches required pattern /^apply-cluster-docflow-prod:.*apply-traefik-config-docflow-prod/`,
while adding an unrelated prerequisite keeps passing.

## Remediation

Add the missing required text, or remove the forbidden text — the finding names the exact
literal. If a heading legitimately moved, update the instance's `require` list in the same
change that moves it.
