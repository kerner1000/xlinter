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
  /** Nested parse: this node's string value parsed as its own YAML document. */
  parseAsYaml(): StructuredDoc;
}

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

export function makeDoc(
  file: string,
  docs: readonly { value: unknown; positionOf: PositionOf; docIndex?: number }[],
): StructuredDoc {
  const roots = docs.map((d) =>
    makeNode(file, d.value, [], d.positionOf, d.docIndex),
  );
  return {
    roots,
    select(path: string): DocNode[] {
      return roots.flatMap((r) => r.select(path));
    },
  };
}

function makeNode(
  file: string,
  value: unknown,
  path: readonly (string | number)[],
  positionOf: PositionOf,
  docIndex: number | undefined,
): DocNode {
  const pos = positionOf(path);
  const locator: Locator = { file, docPath: renderDocPath(path) };
  if (pos?.line !== undefined) locator.line = pos.line;
  if (pos?.column !== undefined) locator.column = pos.column;
  if (docIndex !== undefined) locator.docIndex = docIndex;
  const node: DocNode = {
    value,
    locator,
    path,
    get(key: string | number): DocNode | undefined {
      const child = childValue(value, key);
      if (child === undefined) return undefined;
      return makeNode(file, child, [...path, key], positionOf, docIndex);
    },
    select(selector: string): DocNode[] {
      const segments = parseSelector(selector);
      return evaluate(node, segments);
    },
    parseAsYaml(): StructuredDoc {
      if (typeof value !== "string") {
        throw new TypeError(
          `parseAsYaml() requires a string node, got ${typeof value} at ${locator.docPath}`,
        );
      }
      return parseStructured(file, value, "yaml");
    },
  };
  return node;
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
