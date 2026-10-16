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
| `decode`       | `object`  | —       | Check a document carried as a string inside the file (see below).    |
| `select`       | `string`  | —       | Required. Selector for the nodes each assertion runs against.        |
| `requireMatch` | `boolean` | `false` | Report an `absence` finding when `select` matches no node in a file. |
| `assert`       | `array`   | —       | Required (min 1). Assertions, each applied to every selected node.   |
| `order`        | `array`   | `[]`    | Document-order constraints: `{before, after}` selector pairs.        |

Each entry of `assert` names a node-relative `path` (required; `$` re-roots at the selected node)
plus any of these checks:

| Assertion         | Type      | Fires when                                             | Finding kind |
| ----------------- | --------- | ------------------------------------------------------ | ------------ |
| `required`        | `boolean` | `true` and no value exists at `path`                   | `absence`    |
| `absent`          | `boolean` | `true` and any value exists at `path`                  | `forbidden`  |
| `eq`              | any       | the value is not deep-equal to the given value         | `mismatch`   |
| `regex`           | `string`  | the stringified value does not match the regex         | `mismatch`   |
| `enum`            | `array`   | the value is deep-equal to none of the entries         | `mismatch`   |
| `contains`        | `string`  | the stringified value lacks the substring              | `mismatch`   |
| `notContains`     | `string`  | the stringified value contains the substring           | `forbidden`  |
| `notMatch`        | `string`  | the stringified value matches the regex                | `forbidden`  |
| `containsCount`   | `object`  | `substring` occurs a number of times other than `eq`   | `mismatch`   |
| `containsElement` | any       | the value is not an array holding a deep-equal element | `absence`    |
| `scan`            | `object`  | extraction-based checks fail (see below)               | varies       |

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
- `containsElement` respects element boundaries, which `contains` cannot: `contains` stringifies
  the array, so it accepts `…ip=10.0.0.11` for an expected `…ip=10.0.0.1`.
  Object key order does not affect `eq`, `enum`, or `containsElement`; array order and scalar
  types remain significant.

## Embedded documents (`decode`)

Some configuration is carried as a *string* inside structured configuration — a Helm
`valuesContent` block, an embedded policy, a serialized manifest. Text matching over that string
cannot bind a value to the key that owns it, which is the whole failure mode this rule type
exists to prevent. `decode` parses the string and re-roots the rule on the resulting document, so
the entire assertion vocabulary applies to it unchanged.

| Field      | Type      | Default | Description                                                                               |
| ---------- | --------- | ------- | ----------------------------------------------------------------------------------------- |
| `path`     | `string`  | —       | Required. Selector for the string node(s), against the outer file.                        |
| `as`       | `enum`    | —       | Required. `yaml`. Never defaulted, so it still reads correctly if more formats are added. |
| `required` | `boolean` | `true`  | When `false`, a file without the path is simply not covered.                              |

```yaml
rules:
  traefik-host-ports:
    type: nodes
    targets: { include: ["clusters/prod/traefik-config.yaml"] }
    parse: yaml
    decode: { path: "$.spec.valuesContent", as: yaml }
    select: "$"
    assert:
      - { path: "$.ports.web.hostPort", eq: 80, required: true }
      - { path: "$.ports.websecure.hostPort", eq: 443, required: true }
```

Notes:

- The lens is applied **before** `select`, so `select` addresses nodes inside the embedded
  document. In [node-table](node-table.md) this is what lets rows be selected from it.
- `decode.required` defaults to `true`: deleting the carrier is an `absence` finding, not a file
  on which every assertion vacuously passes.
- A carrier that is not a string is a `mismatch`; embedded content that does not parse is a
  `parse-error` on the containing file, always at error severity even for a warning-level rule.
  Neither aborts the run.
- Findings inside an embedded document carry `embeddedIn` (the outer path of the carrier) while
  `docPath` stays relative to the embedded document, so it round-trips against it.
- Positions map exactly for literal block scalars, including explicit indentation indicators
  such as `|2-`. Folded (`>`) and quoted scalars re-wrap or unescape their source, so inner line N
  is not outer line N + k: those degrade to the carrier's own position and emit an advisory note
  saying so.

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
