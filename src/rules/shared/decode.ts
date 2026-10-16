import { z } from "zod";
import { selectorString } from "../../selector/schema.js";
import type { StructuredDoc } from "../../structured/doc.js";
import type { Locator, ReportInput } from "../../rule/types.js";

/**
 * The embedded-document lens. Some configuration is carried as a string
 * *inside* structured configuration — a Helm `valuesContent` block, an
 * embedded script, a serialized policy — and text matching over that string
 * cannot bind a value to the key that owns it. `decode` re-roots the rule on
 * the parsed inner document, so the whole assertion vocabulary applies to it
 * unchanged.
 *
 * It is applied to the document *before* `select`, not after: that is what
 * lets `node-table` select its rows inside the embedded document. A decode
 * applied after `select` would collapse each file to a single row.
 */
export const decodeOption = z.strictObject({
  /** Selector for the string node(s) to parse, against the outer document. */
  path: selectorString,
  /**
   * Required, never defaulted: an explicit `as: yaml` written today still
   * means yaml the day another format is added.
   */
  as: z.enum(["yaml"]),
  /** When false, a file without the path is simply not covered by this rule. */
  required: z.boolean().default(true),
});

export type DecodeOptions = z.infer<typeof decodeOption>;

/**
 * Merge several structured documents into one. Multiple decoded scalars in a
 * file behave like a multi-document file: selectors see every root.
 */
function mergeDocs(docs: readonly StructuredDoc[]): StructuredDoc {
  const roots = docs.flatMap((d) => [...d.roots]);
  return {
    roots,
    select: (path: string) => roots.flatMap((r) => r.select(path)),
  };
}

/**
 * Apply the lens, reporting every failure mode rather than throwing — a throw
 * here would abort the invocation and silently leave the remaining targets
 * unlinted.
 *
 * Returns `undefined` when the rule has nothing to check in this target: the
 * caller should move to the next one. Every such case has either reported a
 * finding or been explicitly declared optional.
 */
export function applyDecode(
  doc: StructuredDoc,
  decode: DecodeOptions,
  file: string,
  report: (finding: ReportInput) => void,
  note: (message: string, locator?: Locator) => void,
): StructuredDoc | undefined {
  const carriers = doc.select(decode.path);
  if (carriers.length === 0) {
    if (decode.required) {
      report({
        kind: "absence",
        message: `decode path ${decode.path} matched no node`,
        locator: { file },
        expected: `a string node at ${decode.path}`,
        found: "no match",
      });
    }
    return undefined;
  }

  const decoded: StructuredDoc[] = [];
  for (const carrier of carriers) {
    const locator: Locator = { ...carrier.locator, file };
    const result = carrier.decode(decode.as);
    if (!result.ok) {
      if (result.reason === "not-a-string") {
        report({
          kind: "mismatch",
          message: `decode target ${decode.path} is not a string`,
          locator,
          expected: "a string scalar to parse",
          found: result.found,
        });
      } else {
        report({
          kind: "parse-error",
          message: `cannot parse embedded ${decode.as} at ${locator.docPath ?? decode.path}: ${result.message}`,
          locator,
          expected: `well-formed ${decode.as}`,
          found: "unparseable content",
        });
      }
      continue;
    }
    if (result.degraded) {
      note(
        `positions degraded to the containing scalar: ${locator.docPath ?? decode.path} ` +
          `in ${file} is not a literal block scalar (|), so inner line numbers cannot be mapped`,
        locator,
      );
    }
    decoded.push(result.doc);
  }

  if (decoded.length === 0) return undefined;
  return mergeDocs(decoded);
}
