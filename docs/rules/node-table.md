---
ruleId: node-table
defaultSeverity: error
---

# node-table

## Summary

A keyed expectation table over structured-document nodes: select row nodes, identify each by a
key, and bind per-key expectations to the node that owns the key. A value on row A can never
satisfy an expectation about row B — the binding is the data model, not a discipline.

## Why

Text-level checks over files with repeated structures are unsound: a threshold from one alert
rule can satisfy a check about another as long as both literals appear somewhere. Keying every
expectation to the owning node makes that class of false pass structurally impossible, and it is
regression-proven by this rule's threshold-swap fixture (two rows exchange values; both fail,
each citing its own key).

## Options

| Option        | Type      | Default | Description                                                        |
| ------------- | --------- | ------- | ------------------------------------------------------------------ |
| `parse`       | `enum`    | —       | Required. `yaml`, `yaml-multi`, `json`, or `frontmatter`.          |
| `select`      | `string`  | —       | Required. Selector for the row nodes.                              |
| `key`         | `string`  | —       | Required. Node-relative selector; must resolve to one scalar.      |
| `closedWorld` | `boolean` | `false` | Every present key must appear in `rows` (requires non-empty rows). |
| `onNoRows`    | `enum`    | `error` | `error` or `pass` when `select` matches nothing.                   |
| `columns`     | `object`  | `{}`    | Named sibling sub-selections: `{path, required (default true)}`.   |
| `common`      | `array`   | `[]`    | Assertions (the shared vocabulary) applied to every row node.      |
| `rows`        | `object`  | `{}`    | Per-key expectations: key → field/column name → value checks.      |

Field names in `rows` cells resolve in this order: a name defined in `columns` → the bound
column node; a name starting with `$` → a node-relative selector; a bare identifier `name` →
shorthand for `$.name`.

Value checks are the shared assertion vocabulary (`eq`, `regex`, `enum`, `contains`,
`notContains`, `notMatch`, `containsCount`, `scan`, `absent`) — see [nodes](nodes.md).

## Examples

```yaml
rules:
  share-otp-alert-bindings:
    type: node-table
    targets: { include: ["alerting/alert-rules.yaml"] }
    parse: yaml
    select: "$.groups[?@.name == 'docflow-share-otp'].rules[*]"
    key: "$.uid"
    closedWorld: true
    columns:
      threshold: { path: "$.data[?@.refId == 'C'].model.expression" }
      expr: { path: "$.data[?@.refId == 'A'].model.expr" }
    common:
      - { path: "$.noDataState", eq: OK }
    rows:
      docflow-share-otp-verify-abuse:
        threshold: { eq: "$B >= 15" }
        expr:
          scan: { extract: '\[[0-9]+[smhd]\]', setEq: ["[15m]"] }
```

A file where `verify-abuse` carries `$B >= 10` fails with a `mismatch` finding whose message is
prefixed `row "docflow-share-otp-verify-abuse":` and whose locator carries `nodeId` — even if
`$B >= 15` appears on some other rule.

Diagnostic contract: key unresolvable → `absence` (row excluded); duplicate key → names the
first owner's document path; a required column matching zero nodes → "binding missing"; more
than one → "binding ambiguous"; a `rows` entry with no matching node → `absence`; an unlisted
key under `closedWorld` → `forbidden`.

## Remediation

Fix the named field on the named row. Expectations are bound per key — never copy a value from
another row to silence a finding; if the row set legitimately changed, update `rows` (and the
closed world) in the same change.
