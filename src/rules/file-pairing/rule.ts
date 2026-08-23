import path from "node:path";
import { z } from "zod";
import { defineRule } from "../../rule/define.js";

const options = z.strictObject({
  /** Basename of the anchor file (e.g. "AGENTS.md"). */
  left: z.string().min(1),
  /** Basename that must co-exist in the same directory (e.g. "CLAUDE.md"). */
  right: z.string().min(1),
  /** Also require left when right exists. */
  bidirectional: z.boolean().default(true),
});

export const filePairingRule = defineRule<z.infer<typeof options>>({
  type: "file-pairing",
  meta: {
    summary: "Sibling files must co-exist (e.g. AGENTS.md ⇄ CLAUDE.md)",
    docs: new URL("../../../docs/rules/file-pairing.md", import.meta.url),
    defaultSeverity: "error",
    remediation: "Create the missing sibling file next to its pair.",
    optionsSchema: options,
  },
  async check(ctx) {
    const { left, right, bidirectional } = ctx.options;
    for (const target of ctx.targets) {
      const basename = path.posix.basename(target.relPath);
      const dir = path.posix.dirname(target.relPath);
      const expectSibling =
        basename === left ? right : bidirectional && basename === right ? left : undefined;
      if (expectSibling === undefined) continue;
      const siblingRel = dir === "." ? expectSibling : `${dir}/${expectSibling}`;
      const siblingAbs = path.join(ctx.root.absPath, siblingRel);
      const info = await ctx.stat({
        absPath: siblingAbs,
        relPath: siblingRel,
        root: ctx.root,
        nodeType: "file",
      });
      if (info.nodeType === "missing") {
        ctx.report({
          kind: "absence",
          message: `${basename} has no sibling ${expectSibling}`,
          locator: { file: target.relPath },
          expected: siblingRel,
          found: "missing",
        });
      }
    }
  },
});
