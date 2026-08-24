---
ruleId: nodes
defaultSeverity: error
---

# nodes

## Summary

Parses each matched file as a structured document (YAML, multi-document YAML, JSON, or markdown
frontmatter), selects nodes with a JSONPath-style selector, and runs scalar assertions against each
selected node. It is the general-purpose "this field must look like that" rule for configuration
and metadata files.

## Why

Structured files carry contracts — a `package.json` license, a frontmatter key, a required field on
every list entry — that plain-text linting cannot see. Asserting on parsed nodes checks the actual
value at an actual path, yields findings located at the offending line, and keeps the invariant
robust against reformatting, reordering, and quoting changes.

## Options

| Option         | Type      | Default | Description                                                          |
| -------------- | --------- | ------- | -------------------------------------------------------------------- |
| `parse`        | `enum`    | —       | Required. `yaml`, `yaml-multi`, `json`, or `frontmatter`.            |
| `select`       | `string`  | —       | Required. Selector for the nodes each assertion runs against.        |
| `requireMatch` | `boolean` | `false` | Report an `absence` finding when `select` matches no node in a file. |
| `assert`       | `array`   | —       | Required (min 1). Assertions, each applied to every selected node.   |
| `order`        | `array`   | `[]`    | Document-order constraints: `{before, after}` selector pairs.        |

Each entry of `assert` names a node-relative `path` (required; `$` re-roots at the selected node)
plus any of these checks:

| Assertion       | Type      | Fires when                                           | Finding kind |
| --------------- | --------- | ---------------------------------------------------- | ------------ |
| `required`      | `boolean` | `true` and no value exists at `path`                 | `absence`    |
| `absent`        | `boolean` | `true` and any value exists at `path`                | `forbidden`  |
| `eq`            | any       | the value is not deep-equal to the given value       | `mismatch`   |
| `regex`         | `string`  | the stringified value does not match the regex       | `mismatch`   |
| `enum`          | `array`   | the value is deep-equal to none of the entries       | `mismatch`   |
| `contains`      | `string`  | the stringified value lacks the substring            | `mismatch`   |
| `notContains`   | `string`  | the stringified value contains the substring         | `forbidden`  |
| `notMatch`      | `string`  | the stringified value matches the regex              | `forbidden`  |
| `containsCount` | `object`  | `substring` occurs a number of times other than `eq` | `mismatch`   |
| `scan`          | `object`  | extraction-based checks fail (see below)             | varies       |

Evaluation notes:

- Selectors use the owned JSONPath subset: `$` (root), `.name` / `['name']` (named child),
  `[0]` (index; negative counts from the end), `[*]` / `.*` (wildcard), and filters
  `[?@.field]`, `[?@.field == 'value']`, `[?@.a != 3]`, conjoined with `&&` (`@.a` or `@.a.b`
  paths, number or quoted-string literals only). Recursive descent (`..`), slices, and unions
  are reserved and rejected as config errors.
- `scan` extracts every match of a regex (optionally a capture `group`, optionally `split` on a
  delimiter) from each value and then asserts: `first` (checks on the first extraction), `each`
  (checks on every extraction), `setEq` (the deduplicated set of all extractions across every
  matched value equals exactly the given set — an empty extraction set fails a non-empty
  expectation). With `each`/`first`, at least one extraction is required unless
  `allowEmpty: true`; `minCount` overrides the threshold.
- `order` entries are evaluated against the document root of each file: every node matched by
  `before` must precede every node matched by `after` in document order. Either selector
  matching nothing is an `absence` finding.
- With `parse: yaml-multi`, `select` runs across all documents in the file.
- A failing `required` or `absent` check short-circuits the remaining checks of that assertion;
  the value checks (`eq`, `regex`, `enum`, `contains`, `notContains`) each run against every value
  matched by `path`.
- A file the parser cannot read produces a `parse-error` finding — malformed target content is
  always an error.
- When `requireMatch` is `false`, a file where `select` matches nothing passes silently.

## Examples

A minimal `.xlinter.yaml` instance asserting on markdown frontmatter:

```yaml
rules:
  doc-frontmatter:
    type: nodes
    targets: { include: ["docs/rules/*.md"], exclude: ["docs/rules/README.md"] }
    parse: frontmatter
    select: "$"
    requireMatch: true
    assert:
      - path: "$.ruleId"
        required: true
        regex: '^[a-z0-9-]+$'
      - path: "$.defaultSeverity"
        required: true
        enum: [error, warn, note]
```

A violating input — `docs/rules/nodes.md` has frontmatter that misspells the key:

```markdown
---
ruleID: nodes
defaultSeverity: error
---
```

The rule reports an `absence` finding for the missing required value:

```text
docs/rules/nodes.md:1  error  xlinter/doc-frontmatter
  required value $.ruleId is missing
  expected: $.ruleId   found: missing
```

## Remediation

Set the named field on the named node to a value satisfying the assertion — the finding's
`expected`/`found` pair states the exact gap, and its locator carries the document path (and line,
when the parser can supply one) of the offending node. For `forbidden` findings, remove the field.
For `parse-error` findings, fix the file's syntax first; assertions run only on content that
parses.
