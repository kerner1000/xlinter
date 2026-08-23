import path from "node:path";
import { z } from "zod";
import { defineRule } from "../../rule/define.js";

const options = z.strictObject({
  /**
   * Regex the first H1 text must satisfy. `${stem}` is substituted with the
   * regex-escaped filename stem before compilation.
   */
  pattern: z.string().min(1),
});

export const firstHeadingRule = defineRule<z.infer<typeof options>>({
  type: "first-heading",
  meta: {
    summary: "The first H1 of every matched markdown file matches a pattern",
    docs: new URL("../../../docs/rules/first-heading.md", import.meta.url),
    defaultSeverity: "error",
    remediation: "Add or fix the file's first `# ` heading to match the required pattern.",
    optionsSchema: options,
  },
  async check(ctx) {
    for (const target of ctx.targets) {
      const text = await ctx.readText(target);
      const lines = text.split("\n");
      let i = 0;
      // Skip a leading frontmatter block.
      if (lines[0]?.trim() === "---") {
        for (i = 1; i < lines.length; i++) {
          const t = lines[i]?.trim();
          if (t === "---" || t === "...") {
            i += 1;
            break;
          }
        }
      }
      let h1: { text: string; line: number } | undefined;
      for (; i < lines.length; i++) {
        const line = lines[i] ?? "";
        if (line.startsWith("# ")) {
          h1 = { text: line.slice(2).trim(), line: i + 1 };
          break;
        }
        if (/^#{2,6} /.test(line)) break; // a lower heading before any H1
      }
      if (!h1) {
        ctx.report({
          kind: "absence",
          message: "no first-level heading found",
          locator: { file: target.relPath, line: 1 },
          expected: ctx.options.pattern,
          found: "no H1",
        });
        continue;
      }
      const stem = path.posix.basename(target.relPath).replace(/\.[^.]+$/, "");
      const escapedStem = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern = ctx.options.pattern.replaceAll("${stem}", escapedStem);
      if (!new RegExp(pattern).test(h1.text)) {
        ctx.report({
          kind: "mismatch",
          message: `first heading "${h1.text}" does not match the required pattern`,
          locator: { file: target.relPath, line: h1.line },
          expected: pattern,
          found: h1.text,
        });
      }
    }
  },
});
