import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import { lintProject } from "../../src/index.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const ruleId = "xlinter/package-contract";
type Manifest = Record<string, unknown>;

let root: string;
let manifestText: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "xlinter-package-contract-"));
  manifestText = await readFile(path.join(projectRoot, "package.json"), "utf8");
  const config = parseDocument(await readFile(path.join(projectRoot, ".xlinter.yaml"), "utf8"));
  // Keep the actual policy. Only discovery and the unrelated Markdown adapter
  // differ in this plain directory containing a single package.json.
  config.set("discovery", "walk");
  config.delete("adapters");
  await writeFile(path.join(root, ".xlinter.yaml"), config.toString());
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function checkManifest(change: (manifest: Manifest) => void = () => {}) {
  const manifest = JSON.parse(manifestText) as Manifest;
  change(manifest);
  await writeFile(path.join(root, "package.json"), JSON.stringify(manifest, null, 2));
  const result = await lintProject({ cwd: root, rulesFilter: [ruleId] });
  // A renamed, disabled, or missing rule must not silently pass these tests.
  expect(result.instances).toHaveLength(1);
  expect(result.instances[0]).toMatchObject({ ruleId, ruleType: "nodes" });
  return result;
}

/** Change one known manifest path; undefined deletes the leaf. */
function edit(manifest: Manifest, field: string, value: unknown): void {
  const keys = field.split(".");
  const leaf = keys.pop();
  if (!leaf) throw new Error(`empty manifest field: ${field}`);
  let parent = manifest;
  for (const key of keys) parent = parent[key] as Manifest;
  if (value === undefined) delete parent[leaf];
  else parent[leaf] = value;
}

const requiredFields = [
  "name",
  "license",
  "type",
  "engines.node",
  "files",
  "repository.url",
  "scripts.build",
  "scripts.test",
  "scripts.verify",
  "scripts.prepublishOnly",
];

describe("repository package-contract policy", () => {
  it("accepts the current package", async () => {
    const result = await checkManifest();
    expect(result.failed).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.instances[0]?.outcome).toBe("pass");
  });

  it("allows version, descriptive metadata, and unrelated development scripts to change", async () => {
    const result = await checkManifest((manifest) => {
      manifest.version = "0.3.1";
      manifest.description = "Updated package description";
      (manifest.scripts as Manifest).format = "tsc --version";
    });
    expect(result.failed).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it.each(requiredFields)("rejects deleting %s", async (field) => {
    const result = await checkManifest((manifest) => edit(manifest, field, undefined));
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId,
      kind: "absence",
      message: `required value $.${field} is missing`,
      locator: expect.objectContaining({ file: "package.json" }),
    }));
  });

  it.each(requiredFields)("rejects changing %s", async (field) => {
    const result = await checkManifest((manifest) => edit(manifest, field, "changed"));
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId,
      kind: "mismatch",
      message: `$.${field} has the wrong value`,
      locator: expect.objectContaining({ file: "package.json" }),
    }));
  });

  it.each(["engines", "repository", "scripts"])("rejects deleting the %s container", async (field) => {
    const result = await checkManifest((manifest) => { delete manifest[field]; });
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId,
      kind: "absence",
      found: "missing",
    }));
  });

  it.each(["dist", "docs", "schema", "LICENSE", "README.md"])("rejects dropping %s from files", async (entry) => {
    const result = await checkManifest((manifest) => {
      manifest.files = (manifest.files as string[]).filter((file) => file !== entry);
    });
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId, kind: "mismatch", message: "$.files has the wrong value",
    }));
  });

  it.each(["scripts", "src", "."])("rejects adding %s to files", async (entry) => {
    const result = await checkManifest((manifest) => { (manifest.files as string[]).push(entry); });
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId, kind: "mismatch", message: "$.files has the wrong value",
    }));
  });

  it("rejects reordering the exact files allowlist", async () => {
    const result = await checkManifest((manifest) => { (manifest.files as string[]).reverse(); });
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId, kind: "mismatch", message: "$.files has the wrong value",
    }));
  });

  it.each(["prepack", "prepare", "postpack", "publish", "postpublish"])("rejects the %s lifecycle script", async (hook) => {
    const result = await checkManifest((manifest) => {
      (manifest.scripts as Manifest)[hook] = "node -e \"console.log('unexpected publish hook')\"";
    });
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      ruleId,
      kind: "forbidden",
      message: `forbidden value $.scripts.${hook} is present`,
      locator: expect.objectContaining({ file: "package.json" }),
    }));
  });
});
