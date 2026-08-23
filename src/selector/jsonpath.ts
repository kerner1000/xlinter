/**
 * Owned JSONPath parser — deliberately the M1 grammar only:
 *
 *   $            root
 *   .name        named child (bare identifier)
 *   ['name']     named child (quoted, single or double quotes)
 *   [0]          index child
 *   [*] or .*    wildcard
 *
 * Filters (`[?...]`), recursive descent (`..`), slices (`[a:b]`), and unions
 * (`[a,b]`) are RESERVED: they parse to an explicit error naming the future
 * milestone, so no selector written today changes meaning when they arrive.
 * A bad selector is a config error (exit 2), never a lint failure.
 */

export type Segment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

export class SelectorError extends Error {
  constructor(
    message: string,
    readonly selector: string,
    readonly column: number,
  ) {
    super(`${message} (in selector ${JSON.stringify(selector)}, col ${column})`);
    this.name = "SelectorError";
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$-]*/;

export function parseSelector(input: string): Segment[] {
  const src = input.trim();
  if (!src.startsWith("$")) {
    throw new SelectorError("selector must start with '$'", input, 1);
  }
  const segments: Segment[] = [];
  let i = 1;
  while (i < src.length) {
    const col = i + 1;
    const ch = src[i];
    if (ch === ".") {
      if (src[i + 1] === ".") {
        throw new SelectorError(
          "recursive descent '..' is reserved for a future xlinter version (node-table milestone)",
          input,
          col,
        );
      }
      i += 1;
      if (src[i] === "*") {
        segments.push({ kind: "wildcard" });
        i += 1;
        continue;
      }
      const m = IDENT.exec(src.slice(i));
      if (!m) {
        throw new SelectorError("expected a property name after '.'", input, i + 1);
      }
      segments.push({ kind: "key", key: m[0] });
      i += m[0].length;
      continue;
    }
    if (ch === "[") {
      const close = findClose(src, i, input);
      const inner = src.slice(i + 1, close).trim();
      if (inner.startsWith("?")) {
        throw new SelectorError(
          "filter selectors '[?...]' are reserved for a future xlinter version (node-table milestone)",
          input,
          col,
        );
      }
      if (inner === "*") {
        segments.push({ kind: "wildcard" });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
      } else if (
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) ||
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)
      ) {
        if (inner.includes(",")) {
          // A quoted name may legitimately contain a comma; only treat top-level
          // commas outside quotes as unions. Since we already have a full quoted
          // string spanning the bracket, this IS a single name.
        }
        segments.push({ kind: "key", key: inner.slice(1, -1) });
      } else if (inner.includes(":")) {
        throw new SelectorError(
          "slice selectors '[a:b]' are reserved for a future xlinter version",
          input,
          col,
        );
      } else if (inner.includes(",")) {
        throw new SelectorError(
          "union selectors '[a,b]' are reserved for a future xlinter version",
          input,
          col,
        );
      } else {
        throw new SelectorError(
          `unrecognized bracket selector [${inner}] — expected [*], [<index>], or ['name']`,
          input,
          col,
        );
      }
      i = close + 1;
      continue;
    }
    throw new SelectorError(`unexpected character '${ch}'`, input, col);
  }
  return segments;
}

function findClose(src: string, open: number, original: string): number {
  let quote: string | undefined;
  for (let j = open + 1; j < src.length; j++) {
    const c = src[j];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "]") return j;
  }
  throw new SelectorError("unclosed '['", original, open + 1);
}

/** Render segments back to canonical form (used in docPath construction). */
export function renderPath(segments: readonly Segment[]): string {
  let out = "$";
  for (const s of segments) {
    if (s.kind === "key") {
      out += /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s.key) ? `.${s.key}` : `['${s.key}']`;
    } else if (s.kind === "index") {
      out += `[${s.index}]`;
    } else {
      out += "[*]";
    }
  }
  return out;
}
