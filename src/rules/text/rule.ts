import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import { regexString } from "../../selector/schema.js";

const options = z
  .strictObject({
    /** Literals that must appear somewhere in the file. */
    require: z.array(z.string().min(1)).default([]),
    /** Literals that must not appear anywhere in the file. */
    forbid: z.array(z.string().min(1)).default([]),
    /**
     * Patterns that must match somewhere in the file. Use these only where a
     * literal cannot express the invariant — a line whose other content is
     * legitimately open-ended, such as a Make target's prerequisite list.
     * Matched per line (`^`/`$` anchor to a line, not the file).
     */
    requireMatch: z.array(regexString).default([]),
    /** Patterns that must not match any line. */
    forbidMatch: z.array(regexString).default([]),
  })
  .superRefine((o, ctx) => {
    if (
      o.require.length === 0 &&
      o.forbid.length === 0 &&
      o.requireMatch.length === 0 &&
      o.forbidMatch.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "at least one of require/forbid/requireMatch/forbidMatch must be non-empty",
      });
    }
  });

type Options = z.infer<typeof options>;

export const textRule = defineRule<Options>({
  type: "text",
  meta: {
    summary: "Plain-text files contain required literals and avoid forbidden ones",
    docs: new URL("../../../docs/rules/text.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Add the missing required text, or remove the forbidden text; the finding names the exact literal.",
    optionsSchema: options,
  },
  async check(ctx) {
    for (const target of ctx.targets) {
      const file = target.relPath;
      const text = await ctx.readText(target);
      for (const literal of ctx.options.require) {
        if (!text.includes(literal)) {
          ctx.report({
            kind: "absence",
            message: `required text ${JSON.stringify(literal)} not found`,
            locator: { file },
            expected: `contains ${JSON.stringify(literal)}`,
            found: "missing",
          });
        }
      }
      for (const literal of ctx.options.forbid) {
        const idx = text.indexOf(literal);
        if (idx !== -1) {
          let line = 1;
          for (let i = 0; i < idx; i++) if (text[i] === "\n") line += 1;
          ctx.report({
            kind: "forbidden",
            message: `forbidden text ${JSON.stringify(literal)} found`,
            locator: { file, line },
            expected: `no occurrence of ${JSON.stringify(literal)}`,
            found: literal,
          });
        }
      }
      if (ctx.options.requireMatch.length > 0 || ctx.options.forbidMatch.length > 0) {
        const lines = text.split(/\r?\n/);
        for (const pattern of ctx.options.requireMatch) {
          const re = new RegExp(pattern);
          if (!lines.some((l) => re.test(l))) {
            ctx.report({
              kind: "absence",
              message: `no line matches required pattern /${pattern}/`,
              locator: { file },
              expected: `a line matching /${pattern}/`,
              found: "no match",
            });
          }
        }
        for (const pattern of ctx.options.forbidMatch) {
          const re = new RegExp(pattern);
          const idx = lines.findIndex((l) => re.test(l));
          if (idx !== -1) {
            ctx.report({
              kind: "forbidden",
              message: `line matches forbidden pattern /${pattern}/`,
              locator: { file, line: idx + 1 },
              expected: `no line matching /${pattern}/`,
              found: lines[idx] ?? "",
            });
          }
        }
      }
    }
  },
});
