import { describe, expect, it } from "vitest";
import {
  parseSelector,
  renderPath,
  SelectorError,
  type Segment,
} from "../../src/selector/jsonpath.js";

function errFor(input: string): SelectorError {
  try {
    parseSelector(input);
  } catch (e) {
    expect(e).toBeInstanceOf(SelectorError);
    return e as SelectorError;
  }
  throw new Error(`expected SelectorError for ${JSON.stringify(input)}`);
}

describe("parseSelector — valid forms", () => {
  it("parses the bare root '$' to zero segments", () => {
    expect(parseSelector("$")).toEqual([]);
  });

  it("parses a dotted name", () => {
    expect(parseSelector("$.name")).toEqual([{ kind: "key", key: "name" }]);
  });

  it("parses a single-quoted bracket name (spaces allowed)", () => {
    expect(parseSelector("$['quoted name']")).toEqual([
      { kind: "key", key: "quoted name" },
    ]);
  });

  it("parses a double-quoted bracket name", () => {
    expect(parseSelector('$["quoted name"]')).toEqual([
      { kind: "key", key: "quoted name" },
    ]);
  });

  it("parses a non-negative index", () => {
    expect(parseSelector("$[0]")).toEqual([{ kind: "index", index: 0 }]);
  });

  it("parses a negative index", () => {
    expect(parseSelector("$[-1]")).toEqual([{ kind: "index", index: -1 }]);
  });

  it("parses bracket and dot wildcards identically", () => {
    expect(parseSelector("$[*]")).toEqual([{ kind: "wildcard" }]);
    expect(parseSelector("$.*")).toEqual([{ kind: "wildcard" }]);
  });

  it("parses a chained selector", () => {
    expect(parseSelector("$.groups[0].rules[2].uid")).toEqual([
      { kind: "key", key: "groups" },
      { kind: "index", index: 0 },
      { kind: "key", key: "rules" },
      { kind: "index", index: 2 },
      { kind: "key", key: "uid" },
    ]);
  });

  it("treats a quoted name containing a comma as one name, not a union", () => {
    expect(parseSelector("$['a,b']")).toEqual([{ kind: "key", key: "a,b" }]);
  });

  it("respects quotes when finding the closing bracket", () => {
    expect(parseSelector("$['a]b']")).toEqual([{ kind: "key", key: "a]b" }]);
  });

  it("trims surrounding whitespace", () => {
    expect(parseSelector("  $.name  ")).toEqual([{ kind: "key", key: "name" }]);
  });
});

describe("parseSelector — errors carry column info", () => {
  it("rejects a selector not starting with '$' at column 1", () => {
    const e = errFor("name");
    expect(e.message).toContain("selector must start with '$'");
    expect(e.column).toBe(1);
    expect(e.selector).toBe("name");
  });

  it("reserves recursive descent '..'", () => {
    const e = errFor("$..a");
    expect(e.message).toContain("recursive descent '..' is reserved");
    expect(e.column).toBe(2);
  });

  it("reserves filter selectors '[?...]'", () => {
    const e = errFor("$[?(@.x)]");
    expect(e.message).toContain("filter selectors '[?...]' are reserved");
    expect(e.column).toBe(2);
  });

  it("reserves slice selectors '[a:b]'", () => {
    const e = errFor("$[1:2]");
    expect(e.message).toContain("slice selectors '[a:b]' are reserved");
    expect(e.column).toBe(2);
  });

  it("reserves union selectors '[a,b]'", () => {
    const e = errFor("$[a,b]");
    expect(e.message).toContain("union selectors '[a,b]' are reserved");
    expect(e.column).toBe(2);
  });

  it("reports an unclosed bracket at the opening column", () => {
    const e = errFor("$[0");
    expect(e.message).toContain("unclosed '['");
    expect(e.column).toBe(2);
  });

  it("reports a garbage character with its column", () => {
    const e = errFor("$x");
    expect(e.message).toContain("unexpected character 'x'");
    expect(e.column).toBe(2);
  });

  it("reports a missing property name after '.'", () => {
    const e = errFor("$.");
    expect(e.message).toContain("expected a property name after '.'");
    expect(e.column).toBe(3);
  });

  it("rejects an unrecognized bracket body", () => {
    const e = errFor("$[abc]");
    expect(e.message).toContain("unrecognized bracket selector [abc]");
    expect(e.column).toBe(2);
  });
});

describe("renderPath", () => {
  it.each([
    "$",
    "$.name",
    "$['quoted name']",
    "$[0]",
    "$[-1]",
    "$[*]",
    "$.groups[0].rules[2].uid",
  ])("round-trips canonical selector %s", (s) => {
    expect(renderPath(parseSelector(s))).toBe(s);
  });

  it("normalizes '.*' to the canonical '[*]'", () => {
    expect(renderPath(parseSelector("$.*"))).toBe("$[*]");
  });

  it("normalizes a needlessly quoted simple name to dot form", () => {
    expect(renderPath(parseSelector("$['simple']"))).toBe("$.simple");
  });

  it("quotes a dashed key (parseable via dot, but non-canonical) and stays stable", () => {
    const rendered = renderPath(parseSelector("$.foo-bar"));
    expect(rendered).toBe("$['foo-bar']");
    expect(renderPath(parseSelector(rendered))).toBe(rendered);
  });

  it("renders hand-built segments", () => {
    const segments: Segment[] = [
      { kind: "key", key: "a b" },
      { kind: "index", index: 3 },
      { kind: "wildcard" },
    ];
    expect(renderPath(segments)).toBe("$['a b'][3][*]");
  });
});
