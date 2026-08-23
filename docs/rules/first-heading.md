---
ruleId: first-heading
defaultSeverity: error
---

# first-heading

## Summary

Checks that the first level-one heading (`# ...`) of every matched markdown file matches a
configured pattern. A leading YAML frontmatter block is skipped before the scan, and a file with no
H1 at all is a violation in its own right.

## Why

The first H1 is a file's public name: it is what indexes, search results, and generated navigation
show. Tying it to a pattern — typically to the filename stem — guarantees that a file and its title
never disagree, so a reader landing from a link always sees the page they expected.

## Options

| Option    | Type     | Default | Description                                                  |
| --------- | -------- | ------- | ------------------------------------------------------------ |
| `pattern` | `string` | —       | Required. Regular expression the first H1 text must satisfy. |

Before compilation, every `${stem}` occurrence in the pattern is substituted with the
regex-escaped filename stem (the basename with its final extension removed), so
`^${stem}$` requires the H1 to equal the filename stem exactly — even when the stem contains regex
metacharacters. The pattern is not implicitly anchored; write `^...$` to match the whole heading.

Scanning details:

- A leading frontmatter block (`---` ... `---` or `...`) is skipped entirely.
- The first line starting with `#` plus a space is taken as the H1; its text is trimmed before
  matching.
- If a lower-level heading (`##` through `######`) appears before any H1, the scan stops and the
  file is reported as having no first-level heading.

## Examples

A minimal `.xlinter.yaml` instance requiring each rule doc's title to equal its filename stem:

```yaml
rules:
  rule-doc-title:
    type: first-heading
    targets: { include: ["docs/rules/*.md"], exclude: ["docs/rules/README.md"] }
    pattern: '^${stem}$'
```

A violating input — `docs/rules/file-name.md` starts with:

```markdown
# File name rule
```

The rule reports a `mismatch` finding at the heading's line (or an `absence` finding at line 1 when
no H1 exists at all):

```text
docs/rules/file-name.md:1  error  xlinter/rule-doc-title
  first heading "File name rule" does not match the required pattern
  expected: ^file-name$   found: File name rule
```

## Remediation

Add or fix the file's first level-one heading so it matches the required pattern — with the common
`^${stem}$` policy, make the H1 exactly the filename stem, or rename the file so the stem matches
the intended title. Ensure the H1 is the first heading in the body: move any `##`+ sections below
it.
