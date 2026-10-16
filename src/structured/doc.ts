import type { Locator } from "../rule/types.js";
import {
  parseSelector,
  type FilterConjunct,
  type Segment,
} from "../selector/jsonpath.js";
import { parseStructured } from "./parse.js";

/**
 * A node in a parsed structured document. Wraps the plain JS value plus enough
 * position data to produce a precise Locator. `select()` is node-relative
 * (re-roots `$` at this node) — the semantics the node-table rule type
 * depends on. `path` is the structural address within its document; comparing
 * two nodes' paths element-wise decides document order without relying on
 * parser positions.
 */
export interface DocNode {
  readonly value: unknown;
  readonly locator: Locator;
  /** Structural address within the document, e.g. ["groups", 0, "rules", 2]. */
  readonly path: readonly (string | number)[];
  get(key: string | number): DocNode | undefined;
  select(path: string): DocNode[];
  /**
   * Embedded-document lens: this node's string value parsed as its own
   * document. Never throws — every failure mode is a value the caller reports,
   * because a throw here would abort the whole rule invocation and leave the
   * remaining targets unlinted.
   */
  decode(format: EmbeddedFormat): DecodeResult;
}

/** Formats an embedded string may be decoded as. Deliberately one member. */
export type EmbeddedFormat = "yaml";

/**
 * Where a block scalar's content begins in the *outer* file, so inner
 * positions can be mapped back onto it. Only literal blocks (`|`, `|-`)
 * preserve their source line-for-line; see `decode()`.
 */
export interface EmbeddedSource {
  /** 1-based line of the block scalar's first content line. */
  contentStartLine: number;
  /** Columns of indentation stripped from every content line. */
  indent: number;
}

export type SourceOf = (
  path: readonly (string | number)[],
) => EmbeddedSource | undefined;

export type DecodeResult =
  | {
      ok: true;
      doc: StructuredDoc;
      /**
       * True when inner positions could not be mapped and every inner finding
       * carries the containing scalar's own position instead.
       */
      degraded: boolean;
    }
  | { ok: false; reason: "not-a-string"; found: string }
  | { ok: false; reason: "parse-error"; message: string };

export interface StructuredDoc {
  /** Root nodes — one per document (multi-doc YAML yields several). */
  readonly roots: readonly DocNode[];
  /** Select across all documents. */
  select(path: string): DocNode[];
}

/** Position lookup the parser provides per document. */
export type PositionOf = (path: readonly (string | number)[]) => {
  line?: number;
  column?: number;
} | undefined;

/** Per-document context shared by every node built from it. */
interface DocContext {
  file: string;
  positionOf: PositionOf;
  sourceOf?: SourceOf | undefined;
  docIndex?: number | undefined;
  /**
   * Outer docPath of the scalar this document was decoded out of. Present
   * only on decoded documents; stamped onto every finding they produce.
   */
  embeddedIn?: string | undefined;
}

export function makeDoc(
  file: string,
  docs: readonly {
    value: unknown;
    positionOf: PositionOf;
    sourceOf?: SourceOf;
    docIndex?: number;
  }[],
  embeddedIn?: string,
): StructuredDoc {
  const roots = docs.map((d) =>
    makeNode(d.value, [], {
      file,
      positionOf: d.positionOf,
      sourceOf: d.sourceOf,
      docIndex: d.docIndex,
      embeddedIn,
    }),
  );
  return {
    roots,
    select(path: string): DocNode[] {
      return roots.flatMap((r) => r.select(path));
    },
  };
}

function makeNode(
  value: unknown,
  path: readonly (string | number)[],
  ctx: DocContext,
): DocNode {
  const pos = ctx.positionOf(path);
  const locator: Locator = { file: ctx.file, docPath: renderDocPath(path) };
  if (pos?.line !== undefined) locator.line = pos.line;
  if (pos?.column !== undefined) locator.column = pos.column;
  if (ctx.docIndex !== undefined) locator.docIndex = ctx.docIndex;
  if (ctx.embeddedIn !== undefined) locator.embeddedIn = ctx.embeddedIn;
  const node: DocNode = {
    value,
    locator,
    path,
    get(key: string | number): DocNode | undefined {
      const child = childValue(value, key);
      if (child === undefined) return undefined;
      return makeNode(child, [...path, key], ctx);
    },
    select(selector: string): DocNode[] {
      const segments = parseSelector(selector);
      return evaluate(node, segments);
    },
    decode(format: EmbeddedFormat): DecodeResult {
      if (typeof value !== "string") {
        return { ok: false, reason: "not-a-string", found: typeName(value) };
      }
      const source = ctx.sourceOf?.(path);
      try {
        const inner = parseStructured(ctx.file, value, format, {
          ...(source ? { offset: source } : {}),
          embeddedIn: locator.docPath ?? "$",
          // A degraded decode must still land somewhere real: pin every inner
          // finding to the containing scalar rather than to line 1 of a file
          // whose line 1 is something else entirely.
          ...(source
            ? {}
            : {
                pin: {
                  ...(locator.line !== undefined ? { line: locator.line } : {}),
                  ...(locator.column !== undefined ? { column: locator.column } : {}),
                },
              }),
        });
        return { ok: true, doc: inner, degraded: source === undefined };
      } catch (e) {
        return {
          ok: false,
          reason: "parse-error",
          message: e instanceof Error ? e.message : String(e),
        };
      }
    },
  };
  return node;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function childValue(value: unknown, key: string | number): unknown {
  if (value === null || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    if (typeof key !== "number") return undefined;
    const idx = key < 0 ? value.length + key : key;
    return value[idx];
  }
  if (typeof key === "number") return undefined;
  return (value as Record<string, unknown>)[key];
}

function children(node: DocNode): DocNode[] {
  const v = node.value;
  const out: DocNode[] = [];
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const child = node.get(i);
      if (child) out.push(child);
    }
  } else if (v !== null && typeof v === "object") {
    for (const k of Object.keys(v)) {
      const child = node.get(k);
      if (child) out.push(child);
    }
  }
  return out;
}

function conjunctHolds(child: DocNode, c: FilterConjunct): boolean {
  let target: DocNode | undefined = child;
  for (const member of c.members) {
    target = target?.get(member);
  }
  if (c.op === undefined) return target !== undefined;
  if (c.op === "==") {
    if (target === undefined) return false;
    return literalEquals(target.value, c.literal);
  }
  // "!=": RFC semantics — Nothing != value is true.
  if (target === undefined) return true;
  return !literalEquals(target.value, c.literal);
}

function literalEquals(value: unknown, literal: string | number | undefined): boolean {
  if (typeof literal === "number") {
    return typeof value === "number" && value === literal;
  }
  return typeof value === "string" && value === literal;
}

function evaluate(root: DocNode, segments: readonly Segment[]): DocNode[] {
  let current: DocNode[] = [root];
  for (const seg of segments) {
    const next: DocNode[] = [];
    for (const node of current) {
      if (seg.kind === "wildcard") {
        next.push(...children(node));
      } else if (seg.kind === "filter") {
        for (const child of children(node)) {
          if (seg.conjuncts.every((c) => conjunctHolds(child, c))) {
            next.push(child);
          }
        }
      } else if (seg.kind === "key") {
        const child = node.get(seg.key);
        if (child) next.push(child);
      } else {
        const child = node.get(seg.index);
        if (child) next.push(child);
      }
    }
    current = next;
  }
  return current;
}

/**
 * Document-order comparison via structural paths: negative when a precedes b.
 * Numeric indices compare numerically; string keys compare by insertion order
 * only through their numeric positions being equal — mixed segments compare
 * as strings, which is stable and deterministic.
 */
export function comparePaths(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] as string | number;
    const y = b[i] as string | number;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x) < String(y) ? -1 : 1;
  }
  return a.length - b.length;
}

function renderDocPath(path: readonly (string | number)[]): string {
  let out = "$";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p) ? `.${p}` : `['${p}']`;
  }
  return out;
}
