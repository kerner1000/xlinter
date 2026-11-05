import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, parseDocument, stringify } from "yaml";
import { lintProject } from "../../src/index.js";

/**
 * The repository's `release-workflow` policy against edited copies of the real workflow. CI never runs
 * that workflow, which only fires on a tag, so this rule is its automated check.
 */

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const ruleId = "xlinter/release-workflow";
const workflowFile = ".github/workflows/release.yml";

interface Step {
  run?: string;
  uses?: string;
  env?: Record<string, string>;
}
interface Job {
  permissions: Record<string, string>;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  permissions: Record<string, string>;
  env?: Record<string, string>;
  jobs: { build: Job; publish: Job };
}

let root: string;
let workflowText: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "xlinter-release-workflow-"));
  await mkdir(path.join(root, path.dirname(workflowFile)), { recursive: true });
  workflowText = await readFile(path.join(projectRoot, workflowFile), "utf8");
  const config = parseDocument(await readFile(path.join(projectRoot, ".xlinter.yaml"), "utf8"));
  // Keep the actual policy. This plain directory has no Git history or Markdown to lint.
  config.set("discovery", "walk");
  config.delete("adapters");
  await writeFile(path.join(root, ".xlinter.yaml"), config.toString());
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function checkWorkflow(change: (workflow: Workflow) => void = () => {}) {
  const workflow = parse(workflowText) as Workflow;
  change(workflow);
  await writeFile(path.join(root, workflowFile), stringify(workflow));
  const result = await lintProject({ cwd: root, rulesFilter: [ruleId] });
  // A renamed, disabled, or missing rule must not silently pass these tests.
  expect(result.instances).toHaveLength(1);
  expect(result.instances[0]).toMatchObject({ ruleId, ruleType: "nodes" });
  return result;
}

function runStep(job: Job, command: string): Step {
  const step = job.steps.find((candidate) => candidate.run === command);
  if (!step) throw new Error(`no step runs ${command}`);
  return step;
}

const edits: [string, (workflow: Workflow) => void][] = [
  ["a workflow-wide permission", (w) => { w.permissions = { contents: "read" }; }],
  ["an OIDC token for the build job", (w) => { w.jobs.build.permissions["id-token"] = "write"; }],
  ["another permission for the publish job", (w) => { w.jobs.publish.permissions.contents = "write"; }],
  ["no OIDC token for the publish job", (w) => { w.jobs.publish.permissions = {}; }],
  ["a token in the workflow env", (w) => { w.env = { NODE_AUTH_TOKEN: "x" }; }],
  ["a token in the publish job env", (w) => { w.jobs.publish.env = { NODE_AUTH_TOKEN: "x" }; }],
  ["a token in a publish step env", (w) => {
    runStep(w.jobs.publish, "npm stage publish ./xlinter-*.tgz").env = { NODE_AUTH_TOKEN: "x" };
  }],
  ["installing dependencies in the publish job", (w) => { w.jobs.publish.steps.unshift({ run: "npm ci" }); }],
  ["a direct publish", (w) => {
    runStep(w.jobs.publish, "npm stage publish ./xlinter-*.tgz").run = "npm publish ./xlinter-*.tgz";
  }],
  ["another action in the publish job", (w) => {
    w.jobs.publish.steps.unshift({ uses: `actions/checkout@${"a".repeat(40)}` });
  }],
  ["an action on a movable tag in the publish job", (w) => {
    w.jobs.publish.steps.unshift({ uses: "actions/setup-node@v7" });
  }],
  ["an action on a movable tag in the build job", (w) => {
    w.jobs.build.steps.unshift({ uses: "actions/checkout@v7" });
  }],
  ["no publish gate in the build job", (w) => {
    w.jobs.build.steps = w.jobs.build.steps.filter((step) => step.run !== "npm run prepublishOnly");
  }],
  ["packing with scripts on", (w) => {
    runStep(w.jobs.build, "npm pack --ignore-scripts").run = "npm pack";
  }],
  ["packing before the publish gate", (w) => {
    const gate = runStep(w.jobs.build, "npm run prepublishOnly");
    const pack = runStep(w.jobs.build, "npm pack --ignore-scripts");
    gate.run = "npm pack --ignore-scripts";
    pack.run = "npm run prepublishOnly";
  }],
];

describe("repository release-workflow policy", () => {
  it("accepts the current workflow", async () => {
    const result = await checkWorkflow();
    expect(result.findings).toEqual([]);
    expect(result.failed).toBe(false);
    expect(result.instances[0]?.outcome).toBe("pass");
  });

  it.each(edits)("rejects %s", async (_label, change) => {
    const result = await checkWorkflow(change);
    expect(result.failed).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({
        ruleId,
        locator: expect.objectContaining({ file: workflowFile }),
      }),
    );
  });
});
