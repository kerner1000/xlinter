/**
 * Hand-rolled plugin rule pack (plain ESM, no xlinter import). loadPlugins
 * qualifies the type id by specifier, so this rule registers as
 * "./rules/pack.js:always-fails". The config schema only accepts kebab-case
 * `type:` values, so the config references the type through the (unqualified)
 * alias below; findings still carry the qualified canonical id as `ruleType`.
 */
export const rules = [
  {
    type: "always-fails",
    meta: {
      summary: "Always reports one finding (integration-test plugin)",
      docsFile: "/dev/null",
      defaultSeverity: "error",
      remediation: "This rule always fails by design; remove the instance.",
      onUnobservable: "error",
      aliases: ["always-fails"],
      optionsSchema: { safeParse: (v) => ({ success: true, data: v }) },
    },
    check(ctx) {
      ctx.report({ kind: "other", message: "plugin ran", locator: { file: "." } });
    },
  },
];
