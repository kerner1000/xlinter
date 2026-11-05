/**
 * Publish gate, run from `prepublishOnly` before and after the build and checks. The release workflow
 * runs the same chain with `npm run prepublishOnly`, because npm runs no scripts for the tarball it
 * publishes there.
 *
 * `npm publish` packs the working tree, so a green build and test run say nothing about which
 * source is being released. This refuses unless the checkout has no local changes, HEAD is the commit
 * that tag v<version> names, and that commit is on main, all in the repository that package.json
 * declares. It asks that repository directly, because a local tag or origin/main can be as stale as
 * the checkout and `origin` can point anywhere. Anything that prevents the check refuses the publish
 * too.
 *
 * This catches mistakes. It is not a control against a deliberate bypass: `--ignore-scripts` skips it
 * outright, and local Git config such as `core.worktree` or `url.*.insteadOf` can mislead it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAIN_REF = "refs/heads/main";
const TIMEOUT_MS = 30_000;
/** The `files` entry that `npm run build` empties and refills; what it held before the build is gone. */
const REBUILT_ENTRY = "dist";
/** Compiled into dist/ without being packed itself, so npm's file list does not cover it. */
const COMPILED_DIR = "src";

const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
// These would make Git inspect the repository they name instead of this checkout.
for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];

function run(command, ...args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    env,
  }).trimEnd();
}

const git = (...args) => run("git", ...args);

function indented(lines) {
  return lines.map((line) => `      ${line}`).join("\n");
}

/**
 * The commit a tag names on the remote, if it has that tag. An annotated tag lists its commit under
 * the peeled `^{}` name. `ls-remote` matches patterns against the end of a ref, so compare whole names.
 */
function remoteTagCommit(remote, tag) {
  const ref = `refs/tags/${tag}`;
  const commits = new Map(
    git("ls-remote", "--", remote, ref, `${ref}^{}`)
      .split("\n")
      .map((line) => line.split("\t").reverse()),
  );
  return commits.get(`${ref}^{}`) ?? commits.get(ref);
}

/** Whether a commit is in the history of main on the remote, fetched because a local copy can be stale. */
function isOnRemoteMain(remote, commit) {
  if (git("rev-parse", "--is-shallow-repository") === "true") {
    throw new Error("the clone is shallow, so its history cannot show what main contains");
  }
  git("fetch", "--quiet", "--no-tags", "--", remote, MAIN_REF);
  try {
    git("merge-base", "--is-ancestor", commit, "FETCH_HEAD");
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

/** Tracked and untracked changes; explicit so that Git config cannot hide untracked files. */
function localChanges() {
  const changes = git("status", "--porcelain", "--untracked-files=all");
  return changes ? changes.split("\n") : [];
}

/** Files `git status` does not look at: skip-worktree (S) and assume-unchanged (lowercase tag). */
function flaggedFiles() {
  return git("ls-files", "-v")
    .split("\n")
    .filter((line) => /^[a-zS] /.test(line));
}

/** Packed files outside the commit, using npm's own idea of what it packs, root defaults included. */
function untrackedPackedFiles() {
  const [pack] = JSON.parse(run("npm", "pack", "--dry-run", "--json", "--ignore-scripts"));
  const tracked = new Set(git("ls-files", "-z").split("\0"));
  return pack.files
    .map((file) => file.path)
    .filter((file) => !file.startsWith(`${REBUILT_ENTRY}/`) && !tracked.has(file));
}

/**
 * Ignored files where they affect the release: they compile or pack, and a nested ignore file among
 * them can drop tracked files from the tarball, which npm's file list cannot show.
 */
function ignoredSourceFiles(manifest) {
  const sources = [...manifest.files.filter((entry) => entry !== REBUILT_ENTRY), COMPILED_DIR];
  const ignored = git("ls-files", "--others", "--ignored", "--exclude-standard", "--", ...sources);
  return ignored ? ignored.split("\n") : [];
}

function findProblems(manifest, head, tag, remote) {
  const problems = [];
  const changes = localChanges();
  if (changes.length > 0) problems.push(`the working tree has local changes:\n${indented(changes)}`);
  const flagged = flaggedFiles();
  if (flagged.length > 0) problems.push(`files are hidden from git status:\n${indented(flagged)}`);
  const outside = [...new Set([...untrackedPackedFiles(), ...ignoredSourceFiles(manifest)])];
  if (outside.length > 0) problems.push(`files outside the commit affect the release:\n${indented(outside)}`);
  const tagged = remoteTagCommit(remote, tag);
  if (!tagged) problems.push(`${remote} has no tag ${tag}`);
  else if (head !== tagged) problems.push(`HEAD ${head} is not ${tagged}, the commit ${tag} names on ${remote}`);
  if (!isOnRemoteMain(remote, head)) problems.push(`HEAD ${head} is not on main of ${remote}`);
  return problems;
}

let remote;
let head;
let tag;
let problems;
try {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  remote = manifest.repository.url.replace(/^git\+/, "");
  tag = `v${manifest.version}`;
  head = git("rev-parse", "--verify", "HEAD");
  problems = findProblems(manifest, head, tag, remote);
} catch (error) {
  problems = [`the source could not be verified: ${error.message.trim()}`];
}

if (problems.length > 0) {
  console.error("xlinter publish refused:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('Release from a clean checkout of the version tag on remote main. See "Releasing" in AGENTS.md.');
  process.exitCode = 1;
} else {
  console.log(`publish source OK: ${head} is ${tag} on main of ${remote}`);
}
