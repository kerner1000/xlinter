import {
  LineCounter,
  isCollection,
  isScalar,
  isMap,
  isSeq,
  parseDocument,
  parseAllDocuments,
  type Document,
} from "yaml";
import { DocParseError, type DocFormat } from "../rule/types.js";
import { makeDoc, type PositionOf, type StructuredDoc } from "./doc.js";

/**
 * Parse target content into a StructuredDoc with node→position mapping.
 * JSON is parsed with the YAML parser (JSON is a YAML subset) so positions
 * come for free and one code path serves both. `frontmatter` extracts the
 * leading `---` block of a markdown file and parses it as YAML with line
 * offsets preserved.
 *
 * Malformed content throws DocParseError — the engine converts that into an
 * ERROR finding (kind "parse-error") attributed to the requesting instance;
 * it is never routed through onUnobservable.
 */
export function parseStructured(
  file: string,
  content: string,
  format: DocFormat,
): StructuredDoc {
  switch (format) {
    case "json":
    case "yaml": {
      const lineCounter = new LineCounter();
      const doc = parseDocument(content, { lineCounter, keepSourceTokens: true });
      throwOnErrors(doc, file);
      if (format === "json") {
        // Enforce actual JSON syntax: the YAML parser is laxer; re-check with JSON.parse.
        try {
          JSON.parse(content);
        } catch (e) {
          throw new DocParseError(
            `invalid JSON: ${(e as Error).message}`,
            file,
          );
        }
      }
      return makeDoc(file, [
        { value: doc.toJS(), positionOf: positionLookup(doc, lineCounter) },
      ]);
    }
    case "yaml-multi": {
      const lineCounter = new LineCounter();
      const docs = parseAllDocuments(content, { lineCounter, keepSourceTokens: true });
      for (const d of docs) throwOnErrors(d, file);
      return makeDoc(
        file,
        docs.map((d, i) => ({
          value: d.toJS(),
          positionOf: positionLookup(d, lineCounter),
          docIndex: i,
        })),
      );
    }
    case "frontmatter": {
      const fm = extractFrontmatter(content);
      if (fm === undefined) {
        throw new DocParseError("no frontmatter block found", file, 1);
      }
      const lineCounter = new LineCounter();
      const doc = parseDocument(fm.block, { lineCounter, keepSourceTokens: true });
      throwOnErrors(doc, file, fm.lineOffset);
      const base = positionLookup(doc, lineCounter);
      const offset: PositionOf = (path) => {
        const p = base(path);
        if (!p || p.line === undefined) return p;
        return { ...p, line: p.line + fm.lineOffset };
      };
      return makeDoc(file, [{ value: doc.toJS(), positionOf: offset }]);
    }
  }
}

function throwOnErrors(doc: Document, file: string, lineOffset = 0): void {
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line;
    throw new DocParseError(
      err.message.split("\n")[0] ?? err.message,
      file,
      line === undefined ? undefined : line + lineOffset,
    );
  }
}

function positionLookup(doc: Document, lineCounter: LineCounter): PositionOf {
  return (path) => {
    let node: unknown = doc.contents;
    for (const key of path) {
      if (isMap(node)) {
        if (typeof key === "number") return undefined;
        node = node.get(key, true);
      } else if (isSeq(node)) {
        if (typeof key !== "number") return undefined;
        node = node.get(key, true);
      } else {
        return undefined;
      }
    }
    if ((isScalar(node) || isCollection(node)) && node.range) {
      const pos = lineCounter.linePos(node.range[0]);
      return { line: pos.line, column: pos.col };
    }
    return undefined;
  };
}

function extractFrontmatter(
  content: string,
): { block: string; lineOffset: number } | undefined {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return undefined;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]?.trim();
    if (t === "---" || t === "...") {
      return { block: lines.slice(1, i).join("\n"), lineOffset: 1 };
    }
  }
  return undefined;
}
