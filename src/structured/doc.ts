import type { Locator } from "../rule/types.js";
import { parseSelector, type Segment } from "../selector/jsonpath.js";
import { parseStructured } from "./parse.js";

/**
 * A node in a parsed structured document. Wraps the plain JS value plus enough
 * position data to produce a precise Locator. `select()` is node-relative
 * (re-roots `$` at this node) — the semantics the future node-table rule type
 * depends on, locked in from M1.
 */
export interface DocNode {
  readonly value: unknown;
  readonly locator: Locator;
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

function evaluate(root: DocNode, segments: readonly Segment[]): DocNode[] {
  let current: DocNode[] = [root];
  for (const seg of segments) {
    const next: DocNode[] = [];
    for (const node of current) {
      if (seg.kind === "wildcard") {
        const v = node.value;
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            const child = node.get(i);
            if (child) next.push(child);
          }
        } else if (v !== null && typeof v === "object") {
          for (const k of Object.keys(v)) {
            const child = node.get(k);
            if (child) next.push(child);
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

function renderDocPath(path: readonly (string | number)[]): string {
  let out = "$";
  for (const p of path) {
    if (typeof p === "number") out += `[${p}]`;
    else out += /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p) ? `.${p}` : `['${p}']`;
  }
  return out;
}
