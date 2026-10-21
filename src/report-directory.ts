import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface RunGit {
  sha: string | null;
  branch: string | null;
  clean: boolean;
  directory: string | null;
}

/** Git owns provenance, including worktrees sharing one common report directory. */
export function runGit(root: string): RunGit {
  const read = (...args: string[]) => execFileSync("git", args, {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000,
  }).trim();
  try {
    return {
      sha: read("rev-parse", "HEAD"),
      branch: read("branch", "--show-current") || null,
      clean: read("status", "--porcelain").length === 0,
      directory: join(resolve(root, read("rev-parse", "--git-common-dir")), "bdd-runs"),
    };
  } catch {
    return { sha: null, branch: null, clean: false, directory: null };
  }
}

export function writeRunReport(target: string, report: unknown): void {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Retain newest reports only; unrelated files and other writers' temporary files are untouched. */
export function pruneRunReports(directory: string): void {
  const files: { path: string; size: number }[] = [];
  for (const name of readdirSync(directory).filter((name) => /^\d+-\d+\.json$/u.test(name)).sort()) {
    try {
      const path = join(directory, name);
      files.push({ path, size: statSync(path).size });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (let index = 0; index < files.length && (files.length - index > 200 || bytes > 500_000_000); index++) {
    rmSync(files[index].path, { force: true });
    bytes -= files[index].size;
  }
}
