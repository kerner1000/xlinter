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
import {
  makeDoc,
  type EmbeddedSource,
  type PositionOf,
  type SourceOf,
  type StructuredDoc,
} from "./doc.js";

/**
 * How to relocate the positions of a document that was decoded out of a
 * string inside another file. `offset` maps inner line/column onto the outer
 * file exactly; `pin` is the fallback that puts every inner finding on the
 * containing scalar when exact mapping is impossible.
 */
export interface EmbeddedOptions {
  offset?: EmbeddedSource;
  pin?: { line?: number; column?: number };
  /** Outer docPath of the scalar this content came from. */
  embeddedIn: string;
}

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
  embedded?: EmbeddedOptions,
): StructuredDoc {
  const relocate: (base: PositionOf) => PositionOf = relocator(embedded);
  const embeddedIn = embedded?.embeddedIn;
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
      return makeDoc(
        file,
        [
          {
            value: doc.toJS(),
            positionOf: relocate(positionLookup(doc, lineCounter)),
            ...(format === "yaml" ? { sourceOf: sourceLookup(doc, lineCounter) } : {}),
          },
        ],
        embeddedIn,
      );
    }
    case "yaml-multi": {
      const lineCounter = new LineCounter();
      const docs = parseAllDocuments(content, { lineCounter, keepSourceTokens: true });
      for (const d of docs) throwOnErrors(d, file);
      return makeDoc(
        file,
        docs.map((d, i) => ({
          value: d.toJS(),
          positionOf: relocate(positionLookup(d, lineCounter)),
          sourceOf: sourceLookup(d, lineCounter),
          docIndex: i,
        })),
        embeddedIn,
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
      return makeDoc(file, [{ value: doc.toJS(), positionOf: relocate(offset) }], embeddedIn);
    }
  }
}

/**
 * Wrap a position lookup so an embedded document's positions land in the
 * outer file. `pin` wins over `offset` only when `offset` is absent — a
 * degraded decode reports at the containing scalar rather than at an inner
 * line number that means nothing in the outer file.
 */
function relocator(
  embedded: EmbeddedOptions | undefined,
): (base: PositionOf) => PositionOf {
  if (!embedded) return (base) => base;
  const { offset, pin } = embedded;
  return (base) => (path) => {
    if (!offset) return pin ? { ...pin } : undefined;
    const p = base(path);
    if (!p || p.line === undefined) return pin ? { ...pin } : p;
    return {
      line: offset.contentStartLine + p.line - 1,
      ...(p.column !== undefined ? { column: p.column + offset.indent } : {}),
    };
  };
}

/**
 * Locate the content of literal block scalars (`|`, `|-`) so a decoded inner
 * document's positions can be mapped back exactly. Folded (`>`) and quoted
 * scalars re-wrap or unescape their source, so inner line N is not outer line
 * N + k for any k — they get no entry and the decode degrades instead of
 * reporting a confidently wrong position.
 */
function sourceLookup(doc: Document, lineCounter: LineCounter): SourceOf {
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
    if (!isScalar(node) || node.type !== "BLOCK_LITERAL") return undefined;
    const src = node.srcToken;
    if (!src || src.type !== "block-scalar") return undefined;
    // Carriage returns make the inner parser's column arithmetic diverge from
    // the outer source; do not pretend to map them.
    if (src.source.includes("\r")) return undefined;
    const lastProp = src.props[src.props.length - 1] as
      | { offset?: number; source?: string }
      | undefined;
    if (!lastProp || typeof lastProp.offset !== "number") return undefined;
    if (typeof lastProp.source !== "string") return undefined;
    const contentStart = lastProp.offset + lastProp.source.length;
    const contentLines = src.source.split("\n").filter((l) => l.trim() !== "");
    if (contentLines.length === 0) return undefined;
    const indent = Math.min(
      ...contentLines.map((l) => l.length - l.trimStart().length),
    );
    return { contentStartLine: lineCounter.linePos(contentStart).line, indent };
  };
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
