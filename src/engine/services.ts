import { readFile, lstat, readlink } from "node:fs/promises";
import { UnavailableError, type FsNodeInfo } from "../rule/types.js";

/**
 * The capability container rules observe the world through. M1 ships a real
 * filesystem service and THROWING stubs for git/http/exec — the interfaces
 * exist now so M3/M4 rules (diff-scope, GitHub-state, kustomize-materialized
 * inputs) arrive without changing the RuleContext contract. A rule that
 * declares `meta.requires` resolves stub throws through its declared
 * onUnobservable contract instead of crashing the run.
 */
export interface FsService {
  readText(absPath: string): Promise<string>;
  stat(absPath: string): Promise<FsNodeInfo>;
}

export interface GitService {
  mergeBase(a: string, b: string): Promise<string>;
  diffStatus(baseRef: string): Promise<{ status: string; path: string }[]>;
  lsFiles(): Promise<string[]>;
}

export interface HttpService {
  getJson(url: string): Promise<{ status: number; body: unknown }>;
}

export interface ExecService {
  run(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface Services {
  fs: FsService;
  git: GitService;
  http: HttpService;
  exec: ExecService;
}

export function realServices(): Services {
  return {
    fs: {
      async readText(absPath) {
        return readFile(absPath, { encoding: "utf8" });
      },
      async stat(absPath) {
        try {
          const st = await lstat(absPath);
          if (st.isSymbolicLink()) {
            return {
              nodeType: "symlink",
              symlinkTarget: await readlink(absPath),
            };
          }
          if (st.isDirectory()) return { nodeType: "dir" };
          return { nodeType: "file", size: st.size };
        } catch {
          return { nodeType: "missing" };
        }
      },
    },
    git: {
      mergeBase: () => Promise.reject(new UnavailableError("git-base")),
      diffStatus: () => Promise.reject(new UnavailableError("git-base")),
      lsFiles: () => Promise.reject(new UnavailableError("git-base")),
    },
    http: {
      getJson: () => Promise.reject(new UnavailableError("network")),
    },
    exec: {
      run: (cmd) => Promise.reject(new UnavailableError(`subprocess:${cmd}`)),
    },
  };
}
