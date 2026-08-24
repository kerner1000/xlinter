import { z } from "zod";
import { defineRule } from "../../rule/define.js";

const options = z
  .strictObject({
    /** Literals that must appear somewhere in the file. */
    require: z.array(z.string().min(1)).default([]),
    /** Literals that must not appear anywhere in the file. */
    forbid: z.array(z.string().min(1)).default([]),
  })
  .superRefine((o, ctx) => {
    if (o.require.length === 0 && o.forbid.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "at least one of require/forbid must be non-empty",
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
    }
  },
});
