/**
 * Owned JSONPath parser — deliberately a small grammar:
 *
 *   $                     root
 *   .name                 named child (bare identifier)
 *   ['name'] / ["name"]   named child (quoted)
 *   [0]  [-1]             index child
 *   [*] or .*             wildcard
 *   [?@.f]                filter: field exists on the child
 *   [?@.f == 'v']         filter: equality against a literal (also !=, && chains)
 *
 * Filter subset (RFC 9535-shaped): `@.a` or `@.a.b` (max two members), `==`/`!=`
 * against a number or quoted-string literal, conjunction with `&&`, one optional
 * paren wrap. No `||`, no ordering comparisons, no functions, no path-vs-path.
 * Recursive descent (`..`), slices (`[a:b]`), and unions (`[a,b]`) remain
 * RESERVED: they parse to an explicit error, so no selector written today
 * changes meaning when they arrive. A bad selector is a config error (exit 2),
 * never a lint failure.
 */

export type FilterOp = "==" | "!=";

export interface FilterConjunct {
  /** Members of the relative path: `@.a` => ["a"], `@.a.b` => ["a","b"]. Max 2. */
  members: readonly string[];
  /** Absent => bare existence test. */
  op?: FilterOp;
  literal?: string | number;
}

export type Segment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "filter"; conjuncts: readonly FilterConjunct[] };

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
        segments.push({
          kind: "filter",
          conjuncts: parseFilter(inner.slice(1).trim(), input, col),
        });
      } else if (inner === "*") {
        segments.push({ kind: "wildcard" });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
      } else if (
        (inner.startsWith("'") && inner.endsWith("'") && inner.length >= 2) ||
        (inner.startsWith('"') && inner.endsWith('"') && inner.length >= 2)
      ) {
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
          `unrecognized bracket selector [${inner}] — expected [*], [<index>], ['name'], or [?@.field ...]`,
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

function parseFilter(expr: string, input: string, col: number): FilterConjunct[] {
  let body = expr;
  if (body.startsWith("(") && body.endsWith(")")) {
    body = body.slice(1, -1).trim();
  }
  if (body.includes("||")) {
    throw new SelectorError(
      "'||' is not supported in xlinter filters — use separate rule instances or an enum assertion",
      input,
      col,
    );
  }
  const parts = splitTopLevel(body, "&&");
  if (parts.length === 0 || parts.some((p) => p.trim() === "")) {
    throw new SelectorError("empty filter expression", input, col);
  }
  return parts.map((p) => parseConjunct(p.trim(), input, col));
}

function parseConjunct(part: string, input: string, col: number): FilterConjunct {
  const fnMatch = /^[A-Za-z_]+\s*\(/.exec(part);
  if (fnMatch) {
    throw new SelectorError("filter functions are not supported in xlinter filters", input, col);
  }
  if (!part.startsWith("@")) {
    throw new SelectorError(
      "filter comparisons must compare '@.field' against a number or quoted string literal",
      input,
      col,
    );
  }
  let rest = part.slice(1);
  const members: string[] = [];
  while (rest.startsWith(".")) {
    const m = IDENT.exec(rest.slice(1));
    if (!m) {
      throw new SelectorError("expected a property name after '.' in filter path", input, col);
    }
    members.push(m[0]);
    rest = rest.slice(1 + m[0].length);
  }
  if (members.length === 0) {
    throw new SelectorError(
      "bare '@' is not a valid filter — test existence with '@.field' or compare '@.field == <literal>'",
      input,
      col,
    );
  }
  if (members.length > 2) {
    throw new SelectorError(
      "filter paths support at most two members ('@.a' or '@.a.b')",
      input,
      col,
    );
  }
  rest = rest.trim();
  if (rest === "") {
    return { members };
  }
  const cmp = /^(<=|>=|=~|<|>)/.exec(rest);
  if (cmp) {
    throw new SelectorError(
      `filter comparisons support only '==' and '!=' (got '${cmp[1]}')`,
      input,
      col,
    );
  }
  const opMatch = /^(==|!=)\s*/.exec(rest);
  if (!opMatch) {
    throw new SelectorError(
      `unrecognized filter operator in '${part}' — supported: '==', '!=', bare existence`,
      input,
      col,
    );
  }
  const op = opMatch[1] as FilterOp;
  const litSrc = rest.slice(opMatch[0].length).trim();
  const literal = parseLiteral(litSrc, input, col);
  return { members, op, literal };
}

function parseLiteral(src: string, input: string, col: number): string | number {
  if (/^-?\d+(\.\d+)?$/.test(src)) return Number(src);
  if (
    (src.startsWith("'") && src.endsWith("'") && src.length >= 2) ||
    (src.startsWith('"') && src.endsWith('"') && src.length >= 2)
  ) {
    return src.slice(1, -1);
  }
  if (src.startsWith("@") || src.startsWith("$")) {
    throw new SelectorError(
      "filter comparisons must compare '@.field' against a number or quoted string literal",
      input,
      col,
    );
  }
  throw new SelectorError(
    `invalid filter literal '${src}' — use a number or a quoted string`,
    input,
    col,
  );
}

/** Split on a delimiter, ignoring occurrences inside quotes. */
function splitTopLevel(src: string, delim: "&&"): string[] {
  const parts: string[] = [];
  let quote: string | undefined;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === delim[0] && src.slice(i, i + delim.length) === delim) {
      parts.push(src.slice(start, i));
      start = i + delim.length;
      i += delim.length - 1;
    }
  }
  parts.push(src.slice(start));
  return parts;
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
    } else if (s.kind === "wildcard") {
      out += "[*]";
    } else {
      const body = s.conjuncts
        .map((c) => {
          const path = `@.${c.members.join(".")}`;
          if (c.op === undefined) return path;
          const lit =
            typeof c.literal === "number"
              ? String(c.literal)
              : String(c.literal).includes("'")
                ? `"${c.literal}"`
                : `'${c.literal}'`;
          return `${path} ${c.op} ${lit}`;
        })
        .join(" && ");
      out += `[?${body}]`;
    }
  }
  return out;
}
