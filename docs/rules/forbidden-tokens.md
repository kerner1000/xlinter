---
ruleId: forbidden-tokens
defaultSeverity: error
---

# forbidden-tokens

## Summary

Forbidden literal tokens must not appear in a file — with boundary semantics and an
allowed-forms pre-strip, so legitimate technical forms never trip the scan. Scans raw text by
default, or a selected structured subtree.

## Why

Naive substring scans over-fire (`status_code=` tripping a forbidden `code=`) and under-fire
(one allowed form on a line masking a real violation elsewhere on it). This rule checks the
character before (and optionally after) each hit, and strips *allowed* forms length-preservingly
before scanning, so offsets and line numbers stay exact.

## Options

| Option         | Type     | Default     | Description                                               |
| -------------- | -------- | ----------- | --------------------------------------------------------- |
| `tokens`       | `array`  | —           | Required (min 1). Literal substrings that must not occur. |
| `boundary`     | `enum`   | `word-left` | `word-left`, `word`, or `none` (see table below).         |
| `stripAllowed` | `array`  | `[]`        | Regexes; matches are masked before scanning.              |
| `parse`        | `enum`   | —           | Optional. Parse the file to scan a subtree instead.       |
| `select`       | `string` | —           | Optional (requires `parse`). Subtree selector.            |

| Boundary    | A hit counts when                                                        |
| ----------- | ------------------------------------------------------------------------ |
| `word-left` | the char before the token is not `[A-Za-z0-9_]` (`status_code=` is safe) |
| `word`      | additionally the char after the token is not `[A-Za-z0-9_]`              |
| `none`      | always                                                                   |

With `parse` + `select`, each selected subtree is serialized deterministically and scanned
independently; findings carry the subtree node's locator. This is how a whole alert group —
queries, labels, and annotation prose together — gets a privacy scan.

## Examples

Brand-form guard: the lowercase code form may appear only in code-shaped contexts.

```yaml
rules:
  brand-form:
    type: forbidden-tokens
    targets: { include: ["i18n/locales/*.json"] }
    tokens: [xgenerate]
    boundary: word
    stripAllowed:
      - 'xgenerate[-_/:.]'
```

`Try XGenerate today` passes (different token), `xgenerate.io` passes (stripped), a bare prose
`xgenerate` fails with a `forbidden` finding carrying the exact line and column plus a ±20-char
excerpt.

## Remediation

Remove or rephrase the flagged occurrence. If a *form* of the token is legitimately allowed,
add it to `stripAllowed` — do not weaken the boundary or delete the token.
