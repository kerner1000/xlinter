---
ruleId: file-name
defaultSeverity: error
---

# file-name

## Summary

Checks that the basename of every matched file satisfies a configured regular expression.
Files whose basename appears in the `allow` list pass without being tested. Use it to hold a
directory to a naming scheme such as lowercase kebab-case.

## Why

Consistent file names make a tree predictable for humans, scripts, and agents alike: links do not
break on case-sensitive filesystems, glob patterns stay simple, and generated indexes sort cleanly.
Enforcing the scheme mechanically keeps one stray `Setup Notes.md` from eroding the convention.

## Options

| Option    | Type       | Default | Description                                                                   |
| --------- | ---------- | ------- | ----------------------------------------------------------------------------- |
| `pattern` | `string`   | —       | Required. Regular expression the basename of every matched file must satisfy. |
| `allow`   | `string[]` | `[]`    | Exact basenames that are exempt and pass silently.                            |

The pattern is compiled with JavaScript `RegExp` semantics and tested against the basename only
(never the directory part). It is not implicitly anchored — write `^...$` to match the whole name.

## Examples

A minimal `.xlinter.yaml` instance holding rule docs to kebab-case:

```yaml
rules:
  doc-names:
    type: file-name
    targets: { include: ["docs/**/*.md"] }
    pattern: '^[a-z0-9]+(-[a-z0-9]+)*\.md$'
    allow: [README.md]
```

A violating input — the file `docs/Setup Notes.md` exists. The rule reports a `mismatch` finding on
that file:

```text
docs/Setup Notes.md  error  xlinter/doc-names
  file name "Setup Notes.md" does not match the required pattern
  expected: ^[a-z0-9]+(-[a-z0-9]+)*\.md$   found: Setup Notes.md
```

## Remediation

Rename the file (`git mv`) so its basename matches the required pattern, updating any links that
point at it. If the name is a deliberate exception (for example an ecosystem-mandated file), add its
exact basename to the instance's `allow` list instead of loosening `pattern`.
