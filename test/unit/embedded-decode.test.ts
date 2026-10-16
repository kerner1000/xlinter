import { describe, expect, it } from "vitest";
import { parseStructured } from "../../src/structured/parse.js";
import type { DocNode } from "../../src/structured/doc.js";

/**
 * The parts of `decode` the fixture harness cannot assert: the exact position
 * arithmetic, which scalar styles it refuses to map, and the degraded flag
 * (notes have no fixture matcher).
 */

function carrier(inner: string, style = "|-"): string {
  const indented = inner
    .split("\n")
    .map((l) => (l === "" ? l : `    ${l}`))
    .join("\n");
  return `kind: HelmChartConfig\nspec:\n  valuesContent: ${style}\n${indented}\n`;
}

function decodeSpec(content: string): DocNode[] {
  const doc = parseStructured("chart.yaml", content, "yaml");
  const node = doc.select("$.spec.valuesContent")[0];
  expect(node).toBeDefined();
  return [node as DocNode];
}

describe("decode — literal block scalars map positions exactly", () => {
  const content = carrier(
    ["ports:", "  web:", "    hostPort: 80", "  websecure:", "    hostPort: 443"].join("\n"),
  );

  it("maps an inner node onto the outer line that actually holds it", () => {
    const [node] = decodeSpec(content);
    const result = node!.decode("yaml");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.degraded).toBe(false);

    const outerLines = content.split("\n");
    for (const [path, literal] of [
      ["$.ports.web.hostPort", "        hostPort: 80"],
      ["$.ports.websecure.hostPort", "        hostPort: 443"],
    ] as const) {
      const found = result.doc.select(path)[0];
      expect(found, path).toBeDefined();
      const line = found!.locator.line;
      expect(line, path).toBeDefined();
      // The point of the arithmetic: the reported line is the line an operator
      // edits, not an inner line number that means something else outside.
      expect(outerLines[line! - 1], path).toBe(literal);
    }
  });

  it("offsets the column by the stripped block indentation", () => {
    const [node] = decodeSpec(content);
    const result = node!.decode("yaml");
    if (!result.ok) throw new Error("expected a successful decode");
    const found = result.doc.select("$.ports.websecure.hostPort")[0];
    const { line, column } = found!.locator;
    expect(content.split("\n")[line! - 1]!.slice(column! - 1)).toBe("443");
  });

  it("stamps embeddedIn and keeps docPath relative to the inner document", () => {
    const [node] = decodeSpec(content);
    const result = node!.decode("yaml");
    if (!result.ok) throw new Error("expected a successful decode");
    const found = result.doc.select("$.ports.web.hostPort")[0];
    expect(found!.locator.embeddedIn).toBe("$.spec.valuesContent");
    expect(found!.locator.docPath).toBe("$.ports.web.hostPort");
  });
});

describe("decode — styles that cannot be mapped degrade instead of lying", () => {
  // A folded scalar joins lines and a quoted scalar unescapes, so inner line N
  // is not outer line N + k for any k. Reporting a confidently wrong line is
  // worse than reporting the containing scalar's own.
  for (const style of [">-", ">"]) {
    it(`degrades for a folded scalar (${style})`, () => {
      const [node] = decodeSpec(carrier("service:\n  type: ClusterIP", style));
      const result = node!.decode("yaml");
      if (!result.ok) throw new Error("expected a successful decode");
      expect(result.degraded).toBe(true);
    });
  }

  it("pins degraded findings to the containing scalar, never to line 1", () => {
    const content = carrier("service:\n  type: ClusterIP", ">-");
    const [node] = decodeSpec(content);
    const outerLine = node!.locator.line;
    const result = node!.decode("yaml");
    if (!result.ok) throw new Error("expected a successful decode");
    const found = result.doc.select("$.service.type")[0];
    expect(found!.locator.line).toBe(outerLine);
    expect(found!.locator.line).not.toBe(1);
  });

  it("degrades for a quoted multi-line scalar", () => {
    const content =
      'kind: HelmChartConfig\nspec:\n  valuesContent: "service:\\n  type: ClusterIP\\n"\n';
    const [node] = decodeSpec(content);
    const result = node!.decode("yaml");
    if (!result.ok) throw new Error("expected a successful decode");
    expect(result.degraded).toBe(true);
  });
});

describe("decode — failure modes are values, never throws", () => {
  it("reports a non-string carrier rather than throwing", () => {
    const doc = parseStructured(
      "chart.yaml",
      "kind: HelmChartConfig\nspec:\n  valuesContent:\n    service:\n      type: ClusterIP\n",
      "yaml",
    );
    const node = doc.select("$.spec.valuesContent")[0]!;
    const result = node.decode("yaml");
    expect(result).toEqual({ ok: false, reason: "not-a-string", found: "object" });
  });

  it("reports malformed embedded content rather than throwing", () => {
    const [node] = decodeSpec(carrier("ports: [web\nservice: {}"));
    const result = node!.decode("yaml");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("parse-error");
  });
});


describe("decode — explicit literal indentation preserves columns", () => {
  for (const format of ["yaml", "yaml-multi"] as const) {
    it.each(["|2", "|2-", "|2+", "|-2", "|+2", "|2- # values"])(`${format}: %s`, (style) => {
      // The indicator strips four spaces; the remaining four belong to the
      // inner document and must not be added to its columns a second time.
      const content = carrier("\n    service:\n      type: ClusterIP", style);
      const node = parseStructured("chart.yaml", content, format).select("$.spec.valuesContent")[0]!;
      const result = node.decode("yaml");
      if (!result.ok) throw new Error("expected a successful decode");
      expect(result.degraded).toBe(false);
      const found = result.doc.select("$.service.type")[0]!;
      const { line, column } = found.locator;
      expect(line).toBe(6);
      expect(column).toBe(17);
      expect(content.split("\n")[line! - 1]!.slice(column! - 1)).toBe("ClusterIP");
      expect(found.locator.embeddedIn).toBe("$.spec.valuesContent");
    });
  }

  it.each([
    { path: "$", content: "|2-\n    port: 80\n", column: 11 },
    { path: "$[0]", content: "- |2-\n      port: 80\n", column: 13 },
  ])("maps a literal at $path", ({ path, content, column }) => {
    const node = parseStructured("chart.yaml", content, "yaml").select(path)[0]!;
    const result = node.decode("yaml");
    if (!result.ok) throw new Error("expected a successful decode");
    expect(result.degraded).toBe(false);
    const found = result.doc.select("$.port")[0]!;
    expect(found.locator).toMatchObject({ line: 2, column });
    expect(content.split("\n")[1]!.slice(column - 1)).toBe("80");
  });
});
