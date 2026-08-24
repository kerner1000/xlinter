---
ruleId: cross-file
defaultSeverity: error
---

# cross-file

## Summary

Asserts that a value in one file agrees with a value declared in another file: strict equality,
substring containment, or membership in a declared set. Both files are parsed as structured
documents and addressed with selectors.

## Why

Cross-file contracts — a dashboard uid referenced by alert rules, a service name that must
appear in a registry — silently drift when each file is linted alone. Checking the relation
directly locates the finding at the value to fix and names the declaring file in the expectation.

## Options

| Option     | Type     | Default | Description                                      |
| ---------- | -------- | ------- | ------------------------------------------------ |
| `left`     | `object` | —       | The checked side (see fields below), plus `key`. |
| `right`    | `object` | —       | The declaring side.                              |
| `relation` | `enum`   | —       | `eq`, `contains`, or `memberOf`.                 |

Each side: `file` (exact root-relative path — it must be covered by the instance's
`targets.include`), `parse` (`yaml`, `yaml-multi`, `json`, `frontmatter`), `select` (anchor
nodes, default `$`), `value` (node-relative selector for the compared value). `left.key`
optionally names each checked node's identity for `nodeId` locators.

Multiplicity contract: for `eq`/`contains` the right side must yield exactly one scalar (zero →
`absence`, several → "right value ambiguous"); for `memberOf` the flattened scalars form the
member set. Every left node's `value` must resolve to exactly one scalar.

## Examples

```yaml
rules:
  alert-dashboard-uid-agrees:
    type: cross-file
    targets: { include: ["alerting/alert-rules.yaml", "dashboards/ocr.json"] }
    left:
      file: alerting/alert-rules.yaml
      parse: yaml
      select: "$.groups[*].rules[*]"
      value: "$.dashboardUid"
      key: "$.uid"
    right:
      file: dashboards/ocr.json
      parse: json
      value: "$.uid"
    relation: eq
```

A rule pointing at a renamed dashboard fails with a `mismatch` at that rule's `dashboardUid`,
`expected` rendering the declared uid with its provenance (`from dashboards/ocr.json $.uid`).

## Remediation

Update the left file's value to agree with the declaration — or correct the declaration in the
right file if the estate genuinely moved. The finding's `expected` names the declaring file and
document path, so the fix site is always explicit.
