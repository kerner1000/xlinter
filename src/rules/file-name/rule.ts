import path from "node:path";
import { z } from "zod";
import { defineRule } from "../../rule/define.js";

const options = z.strictObject({
  /** Regex the basename of every matched file must satisfy. */
  pattern: z.string().min(1),
  /** Exempt basenames — pass silently. */
  allow: z.array(z.string()).default([]),
});

export const fileNameRule = defineRule<z.infer<typeof options>>({
  type: "file-name",
  meta: {
    summary: "Every matched file's basename satisfies a naming pattern",
    docs: new URL("../../../docs/rules/file-name.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Rename the file (git mv) to match the required pattern, or add its basename to `allow` if it is a deliberate exception.",
    optionsSchema: options,
  },
  check(ctx) {
    const regex = new RegExp(ctx.options.pattern);
    for (const target of ctx.targets) {
      const basename = path.posix.basename(target.relPath);
      if (ctx.options.allow.includes(basename)) continue;
      if (!regex.test(basename)) {
        ctx.report({
          kind: "mismatch",
          message: `file name "${basename}" does not match the required pattern`,
          locator: { file: target.relPath },
          expected: ctx.options.pattern,
          found: basename,
        });
      }
    }
  },
});
