import path from "node:path";
import { z } from "zod";
import ignoreFactory from "ignore";
import { defineRule } from "../../rule/define.js";

const options = z.strictObject({
  /** Root-relative path of the index file (e.g. "docs/rules/README.md"). */
  index: z.string().min(1),
  /** Which files (root-relative, gitignore-pattern syntax) must be indexed. */
  scope: z.strictObject({
    include: z.array(z.string()).min(1),
    exclude: z.array(z.string()).default([]),
  }),
  direction: z.enum(["both", "files-to-index", "index-to-files"]).default("both"),
});

const LINK = /\[[^\]]*\]\(<?([^)>\s]+)>?\)/g;

export const indexCompletenessRule = defineRule<z.infer<typeof options>>({
  type: "index-completeness",
  meta: {
    summary: "An index file and its directory's contents stay a bidirectional map",
    docs: new URL("../../../docs/rules/index-completeness.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Add the missing index row, or remove/fix the dead index link, in the same change as the file addition/removal.",
    optionsSchema: options,
  },
  async check(ctx) {
    const { index, scope, direction } = ctx.options;
    const indexTarget = ctx.targets.find((t) => t.relPath === index);
    if (!indexTarget) {
      ctx.report({
        kind: "absence",
        message: `index file ${index} not found among the instance's targets`,
        locator: { file: index },
        expected: index,
        found: "missing",
      });
      return;
    }

    const indexDir = path.posix.dirname(index);
    const text = await ctx.readText(indexTarget);
    const linked = new Set<string>();
    const linkLines = new Map<string, number>();
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of (lines[i] ?? "").matchAll(LINK)) {
        const raw = (m[1] ?? "").split("#")[0] ?? "";
        if (raw === "" || /^[a-z]+:/i.test(raw)) continue; // URLs, mailto, anchors
        const resolved = path.posix.normalize(
          indexDir === "." ? raw : `${indexDir}/${raw}`,
        );
        linked.add(resolved);
        if (!linkLines.has(resolved)) linkLines.set(resolved, i + 1);
      }
    }

    const inScope = ignoreFactory().add(scope.include);
    const excluded = ignoreFactory().add([...scope.exclude, index]);
    const scoped = ctx.targets
      .map((t) => t.relPath)
      .filter((rel) => inScope.ignores(rel) && !excluded.ignores(rel));

    if (direction !== "index-to-files") {
      for (const rel of scoped) {
        if (!linked.has(rel)) {
          ctx.report({
            kind: "absence",
            message: `${rel} is not linked from ${index}`,
            locator: { file: rel },
            expected: `a link in ${index}`,
            found: "no link",
          });
        }
      }
    }

    if (direction !== "files-to-index") {
      const scopedSet = new Set(scoped);
      for (const resolved of linked) {
        // Only judge links that point into the index's scope; foreign links are
        // out of this rule's jurisdiction.
        if (!inScope.ignores(resolved) || excluded.ignores(resolved)) continue;
        if (!scopedSet.has(resolved)) {
          ctx.report({
            kind: "mismatch",
            message: `${index} links to ${resolved}, which does not exist`,
            locator: { file: index, ...(linkLines.has(resolved) ? { line: linkLines.get(resolved)! } : {}) },
            expected: `${resolved} to exist`,
            found: "dead link",
          });
        }
      }
    }
  },
});
