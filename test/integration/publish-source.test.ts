import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The publish source guard, against real Git repositories with a local bare remote, and through real
 * `npm publish --dry-run`. The fixture package's `prepublishOnly` runs only the guard, so these tests
 * never recurse into this package's own publish hook.
 */

const execFileAsync = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const guardPath = path.join(projectRoot, "scripts", "check-publish-source.mjs");
const REFUSED = "publish refused";
const UNVERIFIED = "could not be verified";
const fixtureDirs: string[] = [];
let fixtureHome = "";

beforeAll(async () => {
  fixtureHome = await mkdtemp(path.join(tmpdir(), "xlinter-publish-source-home-"));
  fixtureDirs.push(fixtureHome);
});

afterAll(async () => {
  for (const dir of fixtureDirs) await rm(dir, { recursive: true, force: true });
});

/** The environment without the developer's Git and npm settings, so fixtures behave the same anywhere. */
function isolatedEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !/^(git_|npm_config_)/i.test(name),
  );
  return {
    ...Object.fromEntries(inherited),
    HOME: fixtureHome,
    XDG_CONFIG_HOME: path.join(fixtureHome, "config"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
    ...extra,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, env: isolatedEnv() });
  return stdout.trim();
}

interface Checkout {
  /** Temp directory holding the bare remote and the checkout. */
  root: string;
  /** Working tree on `main`, clean and at the tip of the declared remote's `main`. */
  dir: string;
  /** The bare repository `repository.url` names. */
  remote: string;
  /** The commit both sides start on. */
  first: string;
}

function fixtureManifest(repositoryUrl: string): string {
  return JSON.stringify({
    name: "publish-source-fixture",
    version: "1.0.0",
    repository: { type: "git", url: repositoryUrl },
    files: ["dist", "docs", "tracked.txt"],
    scripts: {
      prepublishOnly: `node ${JSON.stringify(guardPath)}`,
      prepack: "node -e \"require('node:fs').writeFileSync('prepack-ran','')\"",
    },
  });
}

async function createCheckout(): Promise<Checkout> {
  const root = await mkdtemp(path.join(tmpdir(), "xlinter-publish-source-"));
  fixtureDirs.push(root);
  const remote = path.join(root, "remote.git");
  const dir = path.join(root, "checkout");
  await git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  await git(root, "init", "--quiet", "--initial-branch=main", dir);
  await writeFile(path.join(dir, ".gitignore"), "dist/\nprepack-ran\n*.local.*\n");
  await writeFile(path.join(dir, "tracked.txt"), "one\n");
  // Sorts before any planted root file, so a check of only the first packed path cannot pass.
  await writeFile(path.join(dir, "LICENSE"), "license\n");
  await mkdir(path.join(dir, "docs"));
  await writeFile(path.join(dir, "docs", "a.md"), "tracked doc\n");
  await writeFile(path.join(dir, "package.json"), fixtureManifest(remote));
  await git(dir, "add", ".gitignore", "tracked.txt", "LICENSE", "docs/a.md", "package.json");
  await git(dir, "commit", "--quiet", "-m", "first");
  await git(dir, "remote", "add", "origin", remote);
  await git(dir, "push", "--quiet", "origin", "main");
  return { root, dir, remote, first: await git(dir, "rev-parse", "HEAD") };
}

/** Commits one change on the current branch and returns the new commit. */
async function commitChange(dir: string, content: string): Promise<string> {
  await writeFile(path.join(dir, "tracked.txt"), content);
  await git(dir, "add", "tracked.txt");
  await git(dir, "commit", "--quiet", "-m", "change");
  return git(dir, "rev-parse", "HEAD");
}

/** Commits a manifest edit, so the checkout stays clean while `repository` changes. */
async function commitManifest(dir: string, edit: (manifest: Record<string, unknown>) => void) {
  const file = path.join(dir, "package.json");
  const manifest = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  edit(manifest);
  await writeFile(file, JSON.stringify(manifest));
  await git(dir, "add", "package.json");
  await git(dir, "commit", "--quiet", "-m", "manifest");
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  file: string,
  args: string[],
  cwd: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, {
      cwd,
      env: isolatedEnv(extraEnv),
      maxBuffer: 16 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code: number; stdout: string; stderr: string };
    return { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
  }
}

const runGuard = (cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> =>
  run(process.execPath, [guardPath], cwd, extraEnv);

function expectRefused(result: Run, ...details: string[]): void {
  expect(result.code).toBe(1);
  expect(result.stderr).toContain(REFUSED);
  for (const detail of details) expect(result.stderr).toContain(detail);
}

/**
 * The registry is a dead port, so nothing can leave the machine even if `--dry-run` were lost. A dry
 * run still looks the package up, and retrying that lookup against the dead port takes over a minute.
 */
const runDryRunPublish = (cwd: string): Promise<Run> =>
  run(
    "npm",
    [
      "publish",
      "--dry-run",
      "--json",
      "--ignore-scripts=false",
      "--registry=http://127.0.0.1:9",
      "--fetch-retries=0",
      "--loglevel=error",
    ],
    cwd,
  );

describe("publish source guard: accepted sources", () => {
  it("passes a clean checkout at the remote main tip and names the commit", async () => {
    const { dir, first } = await createCheckout();
    const result = await runGuard(dir);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("publish source OK");
    expect(result.stdout).toContain(first);
    expect(await git(dir, "status", "--porcelain")).toBe("");
  });

  it("accepts the git+ URL form that package.json uses", async () => {
    const { dir, remote } = await createCheckout();
    await commitManifest(dir, (manifest) => {
      manifest.repository = { type: "git", url: `git+file://${remote}` };
    });
    await git(dir, "push", "--quiet", "origin", "main");

    const result = await runGuard(dir);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
  });

  it("passes a detached linked worktree at the tip, the documented release path", async () => {
    const { root, dir, first } = await createCheckout();
    const worktree = path.join(root, "release");
    await git(dir, "worktree", "add", "--quiet", "--detach", worktree, "origin/main");
    const result = await runGuard(worktree);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(first);
  });

  it("does not count stale build output, which the build replaces", async () => {
    const { dir } = await createCheckout();
    await mkdir(path.join(dir, "dist"));
    await writeFile(path.join(dir, "dist", "stale.js"), "export {};\n");
    expect((await runGuard(dir)).code).toBe(0);
  });
});

describe("publish source guard: wrong commit", () => {
  it("refuses a superseded commit behind the remote main tip", async () => {
    const { dir, first } = await createCheckout();
    const tip = await commitChange(dir, "two\n");
    await git(dir, "push", "--quiet", "origin", "main");
    await git(dir, "reset", "--quiet", "--hard", first);

    expectRefused(await runGuard(dir), first, tip);
  });

  it("asks the remote rather than trusting a stale local origin/main", async () => {
    const { dir, first } = await createCheckout();
    const tip = await commitChange(dir, "two\n");
    await git(dir, "push", "--quiet", "origin", "main");
    await git(dir, "reset", "--quiet", "--hard", first);
    await git(dir, "update-ref", "refs/remotes/origin/main", first);
    expect(await git(dir, "rev-parse", "origin/main")).toBe(await git(dir, "rev-parse", "HEAD"));

    expectRefused(await runGuard(dir), tip);
  });

  it("refuses a local commit ahead of the remote main tip", async () => {
    const { dir, first } = await createCheckout();
    const ahead = await commitChange(dir, "two\n");

    expectRefused(await runGuard(dir), ahead, first);
  });

  it("does not trust a repointed origin that holds the local commit", async () => {
    const { root, dir, first } = await createCheckout();
    const ahead = await commitChange(dir, "two\n");
    const fork = path.join(root, "fork.git");
    await git(root, "init", "--quiet", "--bare", "--initial-branch=main", fork);
    await git(dir, "remote", "set-url", "origin", fork);
    await git(dir, "push", "--quiet", "origin", "main");

    expectRefused(await runGuard(dir), ahead, first);
  });

  it("is not fooled by a branch whose name ends in the main ref", async () => {
    const { dir, first } = await createCheckout();
    const tip = await commitChange(dir, "two\n");
    await git(dir, "push", "--quiet", "origin", "main");
    await git(dir, "push", "--quiet", "origin", `${first}:refs/heads/a/refs/heads/main`);
    await git(dir, "reset", "--quiet", "--hard", first);

    expectRefused(await runGuard(dir), first, tip);
  });

  it("compares with main, not with whatever branch the remote HEAD names", async () => {
    const { dir, remote, first } = await createCheckout();
    await git(dir, "switch", "--quiet", "-c", "other");
    const other = await commitChange(dir, "two\n");
    await git(dir, "push", "--quiet", "origin", "other");
    await git(remote, "symbolic-ref", "HEAD", "refs/heads/other");

    expectRefused(await runGuard(dir), other, first);
  });
});

describe("publish source guard: local changes", () => {
  it("refuses a modified tracked file and names it", async () => {
    const { dir } = await createCheckout();
    await writeFile(path.join(dir, "tracked.txt"), "edited\n");

    expectRefused(await runGuard(dir), " M tracked.txt");
  });

  it("refuses an untracked file, which the build could compile", async () => {
    const { dir } = await createCheckout();
    await writeFile(path.join(dir, "untracked.ts"), "export {};\n");

    expectRefused(await runGuard(dir), "?? untracked.ts");
  });

  it("sees untracked files when Git config hides them from status", async () => {
    const { dir } = await createCheckout();
    await git(dir, "config", "status.showUntrackedFiles", "no");
    await writeFile(path.join(dir, "untracked.ts"), "export {};\n");

    expectRefused(await runGuard(dir), "?? untracked.ts");
  });

  it.each(["--assume-unchanged", "--skip-worktree"])(
    "refuses a tracked file flagged %s, which status cannot see",
    async (flag) => {
      const { dir } = await createCheckout();
      await git(dir, "update-index", flag, "tracked.txt");
      await writeFile(path.join(dir, "tracked.txt"), "edited but hidden\n");
      expect(await git(dir, "status", "--porcelain")).toBe("");

      expectRefused(await runGuard(dir), "tracked.txt");
    },
  );

  it.each([
    ["packed through a files entry", "docs", "notes.local.md"],
    ["compiled from src", "src", "extra.local.ts"],
  ])("refuses an ignored file %s", async (_label, folder, file) => {
    const { dir } = await createCheckout();
    await mkdir(path.join(dir, folder), { recursive: true });
    await writeFile(path.join(dir, folder, file), "local\n");

    expectRefused(await runGuard(dir), `${folder}/${file}`);
  });

  it("refuses a src file ignored only through .git/info/exclude", async () => {
    const { dir } = await createCheckout();
    await mkdir(path.join(dir, "src"));
    await writeFile(path.join(dir, "src", "extra.ts"), "export {};\n");
    await appendFile(path.join(dir, ".git", "info", "exclude"), "src/extra.ts\n");
    expect(await git(dir, "status", "--porcelain")).toBe("");

    expectRefused(await runGuard(dir), "src/extra.ts");
  });

  it("refuses an ignored nested .npmignore, which drops tracked files from the tarball", async () => {
    const { dir } = await createCheckout();
    await writeFile(path.join(dir, "docs", ".npmignore"), "a.md\n");
    await appendFile(path.join(dir, ".git", "info", "exclude"), "docs/.npmignore\n");
    expect(await git(dir, "status", "--porcelain")).toBe("");

    expectRefused(await runGuard(dir), "docs/.npmignore");
  });

  it("refuses an ignored root file npm packs regardless of the files list", async () => {
    const { dir } = await createCheckout();
    await writeFile(path.join(dir, "README.md.orig"), "local notes\n");
    await appendFile(path.join(dir, ".git", "info", "exclude"), "README.md.orig\n");
    expect(await git(dir, "status", "--porcelain")).toBe("");

    expectRefused(await runGuard(dir), "README.md.orig");
  });

  it("inspects the checkout, not a repository named by GIT_DIR", async () => {
    const { root, dir, remote } = await createCheckout();
    const clean = path.join(root, "clean");
    await git(root, "clone", "--quiet", remote, clean);
    await writeFile(path.join(dir, "untracked.ts"), "export {};\n");

    const result = await runGuard(dir, {
      GIT_DIR: path.join(clean, ".git"),
      GIT_WORK_TREE: clean,
    });
    expectRefused(result, "?? untracked.ts");
  });

  it("reads HEAD from the checkout, not from a repository named by GIT_DIR alone", async () => {
    const { root, dir, remote, first } = await createCheckout();
    const clean = path.join(root, "clean");
    await git(root, "clone", "--quiet", remote, clean);
    await git(dir, "commit", "--quiet", "--allow-empty", "-m", "ahead");
    const ahead = await git(dir, "rev-parse", "HEAD");

    expectRefused(await runGuard(dir, { GIT_DIR: path.join(clean, ".git") }), ahead, first);
  });
});

describe("publish source guard: fails closed", () => {
  it("when the declared remote is unreachable", async () => {
    const { root, dir } = await createCheckout();
    await commitManifest(dir, (manifest) => {
      manifest.repository = { type: "git", url: path.join(root, "missing.git") };
    });

    expectRefused(await runGuard(dir), UNVERIFIED);
  });

  it("when the declared remote has no main branch", async () => {
    const { root, dir } = await createCheckout();
    const empty = path.join(root, "empty.git");
    await git(root, "init", "--quiet", "--bare", "--initial-branch=main", empty);
    await commitManifest(dir, (manifest) => {
      manifest.repository = { type: "git", url: empty };
    });

    expectRefused(await runGuard(dir), UNVERIFIED, "has no refs/heads/main");
  });

  it("when the package declares no repository", async () => {
    const { dir } = await createCheckout();
    await commitManifest(dir, (manifest) => {
      delete manifest.repository;
    });

    expectRefused(await runGuard(dir), UNVERIFIED);
  });

  it("when npm cannot list what would ship", async () => {
    const { root, dir } = await createCheckout();
    const bin = path.join(root, "bin");
    await mkdir(bin);
    await writeFile(path.join(bin, "npm"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });

    const result = await runGuard(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}` });
    expectRefused(result, UNVERIFIED, "npm pack");
  });

  it("outside a Git repository", async () => {
    const { remote } = await createCheckout();
    const dir = await mkdtemp(path.join(tmpdir(), "xlinter-publish-source-plain-"));
    fixtureDirs.push(dir);
    await writeFile(path.join(dir, "package.json"), fixtureManifest(remote));

    const result = await runGuard(dir, { GIT_CEILING_DIRECTORIES: path.dirname(dir) });
    expectRefused(result, UNVERIFIED, "git rev-parse");
  });
});

describe("publish source guard through npm publish", () => {
  it("lets a publish from the remote main tip reach the pack", async () => {
    const { dir } = await createCheckout();

    const result = await runDryRunPublish(dir);
    expect(result.stderr).not.toContain(REFUSED);
    expect(result.code).toBe(0);
    expect(existsSync(path.join(dir, "prepack-ran"))).toBe(true);
    expect(result.stdout).toContain('"path": "tracked.txt"');
  });

  it("stops a refused publish before the pack", async () => {
    const { dir } = await createCheckout();
    await commitChange(dir, "two\n");

    const result = await runDryRunPublish(dir);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(REFUSED);
    expect(existsSync(path.join(dir, "prepack-ran"))).toBe(false);
  });
});
