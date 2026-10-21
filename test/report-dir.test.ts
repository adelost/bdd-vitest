import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { vi } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { component, expect, feature, integration } from "../src/index.js";
import { bddRunReporter } from "../src/report.js";

const addFormats = createRequire(import.meta.url)("ajv-formats") as (validator: Ajv2020) => void;

const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const repository = () => {
  const root = mkdtempSync(join(tmpdir(), "bdd-report-dir-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "initial", "--allow-empty");
  return root;
};
const finish = (reporter: ReturnType<typeof bddRunReporter>) => reporter.onTestRunEnd?.([], [], "passed");
const files = (root: string) => readdirSync(join(root, ".git", "bdd-runs")).filter((name) => name.endsWith(".json"));
const read = (root: string, name: string) => JSON.parse(readFileSync(join(root, ".git", "bdd-runs", name), "utf8"));
const selectedRun = (root: string) => new Promise<void>((resolveRun, reject) => {
  const child = spawn(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", root], {
    env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolveRun() : reject(new Error(output)));
});

feature("repository report directory", () => {
  integration("one file per run with git provenance and a null sha when dirty", {
    given: ["a clean repository, not the harness checkout", repository],
    then: ["separate runs survive and dirty or moved HEAD never claims a commit", async (_, root) => {
      const cleanSha = git(root, "rev-parse", "HEAD");
      const writer = () => bddRunReporter({ root, directory: true, commitSha: "untrusted-environment-sha" });
      const first = writer();
      await finish(first);
      const clean = read(root, files(root)[0]);
      expect(clean.run.commitSha).toBe(cleanSha);
      expect(clean.run.branch).toBe("main");
      expect(clean.schemaVersion).toBe("bdd.run.v2");

      writeFileSync(join(root, "dirty"), "uncommitted");
      const dirty = writer();
      rmSync(join(root, "dirty"));
      await finish(dirty);
      const moved = writer();
      git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "moved", "--allow-empty");
      await finish(moved);
      const reportFiles = files(root);
      expect(reportFiles).toHaveLength(3);
      expect(reportFiles.map((name) => read(root, name).run.commitSha).filter(Boolean)).toEqual([cleanSha]);
      expect(readdirSync(join(root, ".git", "bdd-runs")).every((name) => /^\d+-\d+\.json$/.test(name))).toBe(true);
      const changed = writer();
      writeFileSync(join(root, "dirty-at-end"), "uncommitted");
      await finish(changed);
      rmSync(join(root, "dirty-at-end"));
      expect(files(root).map((name) => read(root, name).run.commitSha).filter(Boolean)).toEqual([cleanSha]);
      const worktree = mkdtempSync(join(tmpdir(), "bdd-report-worktree-"));
      try {
        git(root, "worktree", "add", "--detach", worktree);
        await finish(bddRunReporter({ root: worktree, directory: true }));
        expect(files(root)).toHaveLength(5);
        expect(files(root).map((name) => read(root, name)).filter((r) => r.run.branch === null)).toHaveLength(1);
      } finally { git(root, "worktree", "remove", "--force", worktree); }

      // The packaged preset and level runner are exercised by two real worker processes.
      writeFileSync(join(root, "vitest.config.ts"), `import {bddConfig} from ${JSON.stringify(resolve("dist/preset.js"))}; export default bddConfig({root:${JSON.stringify(root)},bddReport:{directory:true},test:{include:['probe.test.ts']}});`);
      writeFileSync(join(root, "probe.test.ts"), `import {unit,expect} from ${JSON.stringify(resolve("dist/index.js"))}; unit('row 203: real opted-in run',{then:['one is one',()=>expect(1).toBe(1)]});`);
      writeFileSync(join(root, ".gitignore"), "node_modules/\n");
      git(root, "add", "vitest.config.ts", "probe.test.ts", ".gitignore");
      git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "runner fixture");
      await Promise.all([selectedRun(root), selectedRun(root)]);
      const actual = files(root).map((name) => read(root, name)).filter((r) => r.tests.length);
      expect(actual).toHaveLength(2);
      expect(actual.every((r) => r.run.commitSha === git(root, "rev-parse", "HEAD"))).toBe(true);
      expect(actual.every((r) => r.tests[0].measuredMs >= 0)).toBe(true);
    }],
    cleanup: (root) => rmSync(root, { recursive: true, force: true }),
  });

  component("keeps 200 files and never fails the run on a write error", {
    given: ["a temporary repository with old reports and a sparse disk-cap fixture", repository],
    then: ["only the newest 200 and at most 500 MB remain, and failed output is diagnostic only", async (_, root) => {
      await finish(bddRunReporter({ root, directory: true }));
      const dir = join(root, ".git", "bdd-runs");
      for (let n = 0; n < 205; n++) writeFileSync(join(dir, `${1000000000000 + n}-1.json`), "{}");
      await finish(bddRunReporter({ root, directory: true }));
      expect(files(root)).toHaveLength(200);
      const large = join(dir, "1000000000204-1.json");
      truncateSync(large, 500_000_001);
      await finish(bddRunReporter({ root, directory: true }));
      expect(files(root)).not.toContain("1000000000204-1.json");
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        await expect(Promise.resolve().then(() => finish(bddRunReporter({ root, outputFile: join(root, ".git", "HEAD", "not-writable.json") })))).resolves.toBeUndefined();
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("report write failed"));
      } finally { warning.mockRestore(); }
    }],
    cleanup: (root) => rmSync(root, { recursive: true, force: true }),
  });

  integration("v2 carries budget and measured work", {
    given: ["the real opted-in fixture runner", () => mkdtempSync(join(tmpdir(), "bdd-report-clock-"))],
    then: ["the work-clock measurement and null skipped measurement satisfy the shared v2 schema", (_, root) => {
      const path = join(root, "run.json");
      const run = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run", "--root", "test/fixtures/run-report"], {
        env: { ...process.env, BDD_REPORT_FILE: path, BDD_REPORT_SCHEMA: "bdd.run.v2", NO_COLOR: "1" }, encoding: "utf8", timeout: 15_000,
      });
      expect(run.status, run.stdout + run.stderr).toBe(0);
      const report = JSON.parse(readFileSync(path, "utf8"));
      const ajv = new Ajv2020({ strict: true });
      addFormats(ajv);
      const valid = ajv.compile(JSON.parse(readFileSync("schema/bdd.run.v2.schema.json", "utf8")));
      expect(valid(report), ajv.errorsText(valid.errors)).toBe(true);
      expect(valid(JSON.parse(readFileSync("test/fixtures/run-v2.json", "utf8")))).toBe(true);
      const [ran, skipped] = report.tests;
      expect(ran.budget).toEqual({ ms: 100, clock: "work" });
      expect(ran.measuredMs).toBeTypeOf("number");
      expect(ran.measuredMs).toBeGreaterThanOrEqual(0);
      expect(skipped.budget).toEqual({ ms: 8000, clock: "work" });
      expect(skipped.measuredMs).toBeNull();
    }],
    cleanup: (root) => rmSync(root, { recursive: true, force: true }),
  });
});
