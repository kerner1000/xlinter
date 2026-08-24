import { z } from "zod";
import { defineRule } from "../../rule/define.js";
import { regexString, selectorString } from "../../selector/schema.js";
import type { Locator } from "../../rule/types.js";

const options = z
  .strictObject({
    /** Literal substrings that must not occur. */
    tokens: z.array(z.string().min(1)).min(1),
    /**
     * word-left: the char before the token must not be [A-Za-z0-9_] (so
     * `status_code=` never trips token `code=`). word: additionally the char
     * after the token must not be [A-Za-z0-9_]. none: every occurrence counts.
     */
    boundary: z.enum(["word-left", "word", "none"]).default("word-left"),
    /** Allowed forms, stripped (length-preserving) before scanning. */
    stripAllowed: z.array(regexString).default([]),
    /** Parse + select a structured subtree to scan instead of the raw text. */
    parse: z.enum(["yaml", "yaml-multi", "json", "frontmatter"]).optional(),
    select: selectorString.optional(),
  })
  .superRefine((o, ctx) => {
    if (o.select !== undefined && o.parse === undefined) {
      ctx.addIssue({ code: "custom", message: "select requires parse" });
    }
  });

type Options = z.infer<typeof options>;

const WORD = /[A-Za-z0-9_]/;

export const forbiddenTokensRule = defineRule<Options>({
  type: "forbidden-tokens",
  meta: {
    summary: "Forbidden tokens must not appear, with boundary and allowed-form stripping",
    docs: new URL("../../../docs/rules/forbidden-tokens.md", import.meta.url),
    defaultSeverity: "error",
    remediation:
      "Remove or rephrase the flagged occurrence; allowed forms belong in stripAllowed, not in prose.",
    optionsSchema: options,
  },
  async check(ctx) {
    const o = ctx.options;
    for (const target of ctx.targets) {
      const file = target.relPath;
      if (o.parse !== undefined && o.select !== undefined) {
        const doc = await ctx.readDoc(target, o.parse);
        for (const node of doc.select(o.select)) {
          const text = JSON.stringify(node.value) ?? "";
          scanText(text, o, (token, _offset, excerpt) => {
            ctx.report({
              kind: "forbidden",
              message: `forbidden token ${JSON.stringify(token)} found`,
              locator: { ...node.locator, file },
              expected: `no occurrence of ${JSON.stringify(token)}`,
              found: excerpt,
            });
          });
        }
      } else {
        const raw = await ctx.readText(target);
        scanText(raw, o, (token, offset, excerpt) => {
          ctx.report({
            kind: "forbidden",
            message: `forbidden token ${JSON.stringify(token)} found`,
            locator: locateOffset(file, raw, offset),
            expected: `no occurrence of ${JSON.stringify(token)}`,
            found: excerpt,
          });
        });
      }
    }
  },
});

function scanText(
  original: string,
  o: Options,
  report: (token: string, offset: number, excerpt: string) => void,
): void {
  let text = original;
  for (const pattern of o.stripAllowed) {
    text = text.replace(new RegExp(pattern, "g"), (m) => "\u0000".repeat(m.length));
  }
  for (const token of o.tokens) {
    let idx = text.indexOf(token);
    while (idx !== -1) {
      if (boundaryHolds(text, idx, token, o.boundary)) {
        const from = Math.max(0, idx - 20);
        const to = Math.min(text.length, idx + token.length + 20);
        const excerpt = text.slice(from, to).replaceAll("\u0000", ""); // strip the NUL mask for readability
        report(token, idx, excerpt);
      }
      idx = text.indexOf(token, idx + token.length);
    }
  }
}

function boundaryHolds(
  text: string,
  idx: number,
  token: string,
  boundary: Options["boundary"],
): boolean {
  if (boundary === "none") return true;
  const before = idx === 0 ? undefined : text[idx - 1];
  if (before !== undefined && WORD.test(before)) return false;
  if (boundary === "word") {
    const after = text[idx + token.length];
    if (after !== undefined && WORD.test(after)) return false;
  }
  return true;
}

function locateOffset(file: string, text: string, offset: number): Locator {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { file, line, column: offset - lineStart + 1 };
}
