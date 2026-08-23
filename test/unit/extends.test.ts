import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig, satisfies } from "../../src/config/extends.js";
import { XlinterConfigError } from "../../src/config/types.js";

const ENGINE_VERSION = "0.1.0";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "xlinter-extends-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

describe("loadConfig — extends resolution over real files", () => {
  it("merges a parent/child chain with the child overriding severity", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "parent.yaml"),
      [
        "version: 1",
        "namespace: base",
        "rules:",
        "  docs:",
        "    type: file-name",
        "    severity: warn",
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "child.yaml"),
      [
        "version: 1",
        "namespace: child",
        'extends: ["./parent.yaml"]',
        "rules:",
        "  base/docs:",
        "    severity: error",
      ].join("\n"),
    );

    const resolved = await loadConfig(path.join(dir, "child.yaml"), ENGINE_VERSION);
    expect(resolved.namespace).toBe("child");
    const entry = resolved.rules.get("base/docs");
    expect(entry).toBeDefined();
    expect(entry?.type).toBe("file-name");
    expect(entry?.severity).toBe("error");
  });

  it("merges a diamond (two parents extending one base) exactly once", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "base.yaml"),
      [
        "version: 1",
        "namespace: base",
        "rules:",
        "  docs:",
        "    type: file-name",
        "exemptions:",
        "  - rule: base/docs",
        "    file: README.md",
        "    reason: seed",
      ].join("\n"),
    );
    await writeFile(
      path.join(dir, "left.yaml"),
      ["version: 1", "namespace: left", 'extends: ["./base.yaml"]'].join("\n"),
    );
    await writeFile(
      path.join(dir, "right.yaml"),
      ["version: 1", "namespace: right", 'extends: ["./base.yaml"]'].join("\n"),
    );
    await writeFile(
      path.join(dir, "entry.yaml"),
      [
        "version: 1",
        "namespace: entry",
        'extends: ["./left.yaml", "./right.yaml"]',
      ].join("\n"),
    );

    const resolved = await loadConfig(path.join(dir, "entry.yaml"), ENGINE_VERSION);
    // Exemptions concatenate without dedupe — a double-merged base would show twice.
    expect(resolved.exemptions).toHaveLength(1);
    expect(resolved.rules.has("base/docs")).toBe(true);
  });

  it("throws an XlinterConfigError mentioning 'cycle' on a circular extends chain", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "a.yaml"),
      ["version: 1", "namespace: a", 'extends: ["./b.yaml"]'].join("\n"),
    );
    await writeFile(
      path.join(dir, "b.yaml"),
      ["version: 1", "namespace: b", 'extends: ["./a.yaml"]'].join("\n"),
    );

    const promise = loadConfig(path.join(dir, "a.yaml"), ENGINE_VERSION);
    await expect(promise).rejects.toThrow(XlinterConfigError);
    await expect(promise).rejects.toThrow(/cycle/);
  });

  it("rejects a config whose engine range excludes this engine", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "config.yaml"),
      ["version: 1", 'engine: ">=99"'].join("\n"),
    );

    const promise = loadConfig(path.join(dir, "config.yaml"), ENGINE_VERSION);
    await expect(promise).rejects.toThrow(XlinterConfigError);
    await expect(promise).rejects.toThrow(/requires engine ">=99"/);
  });

  it("accepts a config whose engine range matches this engine", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "config.yaml"),
      ["version: 1", 'engine: "^0.1.0"'].join("\n"),
    );

    const resolved = await loadConfig(path.join(dir, "config.yaml"), ENGINE_VERSION);
    expect(resolved.engine).toBe("^0.1.0");
  });
});

describe("satisfies", () => {
  it("matches exact versions, with and without the '=' operator", () => {
    expect(satisfies("1.2.3", "1.2.3")).toBe(true);
    expect(satisfies("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfies("1.2.4", "1.2.3")).toBe(false);
  });

  it("handles >= bounds", () => {
    expect(satisfies("0.2.0", ">=0.1.0")).toBe(true);
    expect(satisfies("0.1.0", ">=0.1.0")).toBe(true);
    expect(satisfies("0.0.9", ">=0.1.0")).toBe(false);
  });

  it("handles < bounds", () => {
    expect(satisfies("0.1.9", "<0.2.0")).toBe(true);
    expect(satisfies("0.2.0", "<0.2.0")).toBe(false);
  });

  it("pairs ^0.x on the minor version", () => {
    expect(satisfies("0.1.0", "^0.1.0")).toBe(true);
    expect(satisfies("0.1.9", "^0.1.0")).toBe(true);
    expect(satisfies("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfies("0.0.9", "^0.1.0")).toBe(false);
  });

  it("pairs ^1.x on the major version", () => {
    expect(satisfies("1.2.0", "^1.2.0")).toBe(true);
    expect(satisfies("1.9.9", "^1.2.0")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.0")).toBe(false);
    expect(satisfies("1.1.0", "^1.2.0")).toBe(false);
  });

  it("ANDs space-separated comparators", () => {
    expect(satisfies("0.2.5", ">=0.1.0 <0.3.0")).toBe(true);
    expect(satisfies("0.3.0", ">=0.1.0 <0.3.0")).toBe(false);
    expect(satisfies("0.0.5", ">=0.1.0 <0.3.0")).toBe(false);
  });

  it("returns false for garbage ranges and garbage versions", () => {
    expect(satisfies("1.0.0", "banana")).toBe(false);
    expect(satisfies("1.0.0", "~1.0.0")).toBe(false); // tilde is not supported
    expect(satisfies("banana", ">=1.0.0")).toBe(false);
  });
});
