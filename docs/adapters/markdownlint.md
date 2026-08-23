# markdownlint adapter

The markdownlint adapter runs [markdownlint](https://github.com/DavidAnson/markdownlint) over every
discovered `.md` target and folds its errors into xlinter's normal finding stream — orchestration,
not reimplementation. Upstream stays the authority on what each `MD###` rule means; xlinter adds
target discovery, severity policy, exemption-free aggregation, and uniform output.

## How it works

- **Native library, exact pin.** The adapter imports the upstream Node library in-process
  (`markdownlint/promise`); no subprocess and no separate install. The dependency is exact-pinned
  at `markdownlint@0.41.1`, so a behavior-changing upstream bump is always a deliberate xlinter
  release, never a drive-by.
- **Targets.** For each target root, the adapter lints every discovered target whose path ends in
  `.md` (after the config's `ignore` patterns and discovery mode are applied). With no markdown
  targets the invocation's outcome is `na`.
- **Config passthrough.** The user's markdownlint configuration is handed to upstream untouched.
  `config` may be an inline object or a path (resolved relative to the declaring xlinter config
  file); YAML and JSON files both parse. An unreadable or malformed config file yields a
  `parse-error` finding.

## Configuration

```yaml
adapters:
  markdownlint:
    config: .markdownlint.yaml
    severity: error
    rules:
      MD041: "off"
      line-length: warn
    onUnavailable: error
```

| Field           | Type                            | Default | Description                                        |
| --------------- | ------------------------------- | ------- | -------------------------------------------------- |
| `config`        | `string` or object              | —       | Upstream config: a path or an inline object.       |
| `severity`      | `error` \| `warn` \| `note`     | `error` | Severity for findings without a matching override. |
| `rules`         | map of rule → severity or `off` | `{}`    | Per-rule severity overrides.                       |
| `onUnavailable` | `error` \| `skipped`            | `error` | What an unloadable markdownlint library becomes.   |

## Severity overrides

Keys of `rules` may be upstream rule ids (`MD013`) or any of their aliases (`line-length`), matched
case-insensitively against all of a reported error's rule names; the first configured key that
matches wins. `"off"` overrides are pushed down into the upstream config (the rule is set to
`false`), so disabled rules are not even computed — with a post-lint filter as a safety net.
Everything else falls back to the adapter-level `severity`.

## Output

Each upstream error becomes a finding with:

- `ruleId: markdownlint/<canonical>` (upstream's primary rule name) and `ruleType: markdownlint`;
- kind `mismatch`, message = upstream rule description plus its error detail;
- a locator with the line number and, when upstream reports an error range, the column span;
- a remediation pointing at the upstream rule's documentation URL when available;
- `sourceRuleId` and `sourceRuleAliases` carrying upstream's native names;
- upstream `fixInfo` passed through verbatim as the finding's `fix` field in JSON output, so
  autofix tooling can apply it without re-linting.

## Availability

If the markdownlint library cannot be loaded, the `onUnavailable` contract decides the outcome:
`error` (the default) reports a single `unobservable` error finding, while `skipped` marks the
invocation skipped with the load failure as the reason — visible, but non-failing.
