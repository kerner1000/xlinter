import { describe, expect, it } from "vitest";
import { mergeConfigs } from "../../src/config/merge.js";
import { XlinterConfigError, type RawConfig } from "../../src/config/types.js";

function layer(partial: Partial<RawConfig> & { file: string }): RawConfig {
  return {
    version: 1,
    namespace: "local",
    extends: [],
    roots: [{ path: ".", kind: "repo" }],
    discovery: "auto",
    ignore: [],
    rules: {},
    exemptions: [],
    adapters: {},
    plugins: [],
    ...partial,
  };
}

describe("mergeConfigs — rule instance keying", () => {
  it("qualifies a bare rule name with the defining layer's namespace", () => {
    const resolved = mergeConfigs([
      layer({
        file: "/cfg/base.yaml",
        namespace: "acme",
        rules: { docs: { type: "file-name", params: {} } },
      }),
    ]);
    expect([...resolved.rules.keys()]).toEqual(["acme/docs"]);
    expect(resolved.rules.get("acme/docs")?.type).toBe("file-name");
  });

  it("keeps a name containing '/' as the full instance id", () => {
    const resolved = mergeConfigs([
      layer({
        file: "/cfg/base.yaml",
        namespace: "acme",
        rules: { "other/thing": { type: "file-name", params: {} } },
      }),
    ]);
    expect(resolved.rules.has("other/thing")).toBe(true);
    expect(resolved.rules.has("acme/other/thing")).toBe(false);
  });

  it("lets a child layer override an inherited instance by full id", () => {
    const parent = layer({
      file: "/cfg/parent.yaml",
      namespace: "base",
      rules: { docs: { type: "file-name", severity: "warn", params: {} } },
    });
    const child = layer({
      file: "/cfg/child.yaml",
      namespace: "child",
      rules: { "base/docs": { severity: "error", params: {} } },
    });
    const resolved = mergeConfigs([parent, child]);
    expect(resolved.rules.size).toBe(1);
    const entry = resolved.rules.get("base/docs");
    expect(entry?.type).toBe("file-name");
    expect(entry?.severity).toBe("error");
    expect(entry?.definedIn).toBe("/cfg/child.yaml");
  });
});

describe("mergeConfigs — per-entry field semantics", () => {
  const parent = () =>
    layer({
      file: "/cfg/parent.yaml",
      namespace: "base",
      rules: {
        docs: {
          type: "file-name",
          severity: "warn",
          targets: { include: ["docs/**"] },
          onEmpty: "error",
          params: { pattern: "^[a-z-]+\\.md$", allowIndex: true },
        },
      },
    });

  it("replaces severity per-field, keeping unmentioned fields", () => {
    const child = layer({
      file: "/cfg/child.yaml",
      namespace: "child",
      rules: { "base/docs": { severity: "error", params: {} } },
    });
    const entry = mergeConfigs([parent(), child]).rules.get("base/docs");
    expect(entry?.severity).toBe("error");
    expect(entry?.include).toEqual(["docs/**"]);
    expect(entry?.onEmpty).toBe("error");
    // Child supplied no params, so the parent's params survive untouched.
    expect(entry?.params).toEqual({ pattern: "^[a-z-]+\\.md$", allowIndex: true });
  });

  it("replaces params WHOLE when the child supplies any param key (no deep merge)", () => {
    const child = layer({
      file: "/cfg/child.yaml",
      namespace: "child",
      rules: { "base/docs": { params: { pattern: "^other$" } } },
    });
    const entry = mergeConfigs([parent(), child]).rules.get("base/docs");
    expect(entry?.params).toEqual({ pattern: "^other$" });
    expect(entry?.params).not.toHaveProperty("allowIndex");
  });

  it("treats type as immutable across layers", () => {
    const child = layer({
      file: "/cfg/child.yaml",
      namespace: "child",
      rules: { "base/docs": { type: "nodes", params: {} } },
    });
    expect(() => mergeConfigs([parent(), child])).toThrow(XlinterConfigError);
    expect(() => mergeConfigs([parent(), child])).toThrow(/type is immutable across config layers/);
  });
});

describe("mergeConfigs — 'off' tombstones", () => {
  const defining = () =>
    layer({
      file: "/cfg/parent.yaml",
      namespace: "base",
      rules: { docs: { type: "file-name", params: {} } },
    });

  it("removes an instance disabled by a later layer", () => {
    const off = layer({
      file: "/cfg/child.yaml",
      namespace: "child",
      rules: { "base/docs": "off" },
    });
    const resolved = mergeConfigs([defining(), off]);
    expect(resolved.rules.has("base/docs")).toBe(false);
    expect(resolved.rules.size).toBe(0);
  });

  it("re-enables when a later layer restates the entry after 'off'", () => {
    const off = layer({
      file: "/cfg/mid.yaml",
      namespace: "mid",
      rules: { "base/docs": "off" },
    });
    const restate = layer({
      file: "/cfg/leaf.yaml",
      namespace: "leaf",
      rules: { "base/docs": { params: {} } },
    });
    const resolved = mergeConfigs([defining(), off, restate]);
    const entry = resolved.rules.get("base/docs");
    expect(entry?.enabled).toBe(true);
    expect(entry?.type).toBe("file-name");
    expect(entry?.definedIn).toBe("/cfg/leaf.yaml");
  });
});

describe("mergeConfigs — list and adapter merging", () => {
  it("concatenates and dedupes ignore patterns", () => {
    const a = layer({ file: "/cfg/a.yaml", ignore: ["a/**", "b/**"] });
    const b = layer({ file: "/cfg/b.yaml", ignore: ["b/**", "c/**"] });
    expect(mergeConfigs([a, b]).ignore).toEqual(["a/**", "b/**", "c/**"]);
  });

  it("concatenates exemptions in layer order without deduping", () => {
    const a = layer({
      file: "/cfg/a.yaml",
      exemptions: [{ rule: "base/docs", file: "README.md", reason: "legacy" }],
    });
    const b = layer({
      file: "/cfg/b.yaml",
      exemptions: [{ rule: "base/docs", file: "README.md", reason: "legacy" }],
    });
    const resolved = mergeConfigs([a, b]);
    expect(resolved.exemptions).toHaveLength(2);
    expect(resolved.exemptions[0]?.reason).toBe("legacy");
  });

  it("shallow-merges the markdownlint adapter rules record across layers", () => {
    const a = layer({
      file: "/cfg/a.yaml",
      adapters: {
        markdownlint: {
          severity: "error",
          rules: { MD013: "warn", MD001: "error" },
          onUnavailable: "error",
        },
      },
    });
    const b = layer({
      file: "/cfg/b.yaml",
      adapters: { markdownlint: { rules: { MD013: "off" } } },
    });
    const md = mergeConfigs([a, b]).adapters.markdownlint;
    expect(md?.rules).toEqual({ MD001: "error", MD013: "off" });
    // Fields the child did not supply fall back to the parent's values.
    expect(md?.severity).toBe("error");
    expect(md?.onUnavailable).toBe("error");
  });
});
