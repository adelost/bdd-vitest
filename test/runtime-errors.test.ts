import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { expect } from "vitest";
import { component, feature, integration } from "../src/index.js";
import type { BddRunReport } from "../src/report.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const vitestBin = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const vitestMajor = Number(JSON.parse(readFileSync(
  resolve(projectRoot, "node_modules/vitest/package.json"),
  "utf8",
)).version.split(".")[0]);
const reportSchema = JSON.parse(readFileSync(
  resolve(projectRoot, "schema/bdd.run.v1.schema.json"),
  "utf8",
)) as object;
const reportValidator = addFormats(new Ajv2020({ allErrors: true, strict: true }))
  .compile(reportSchema);

function runVitest(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [vitestBin, "run", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

feature("runtime contract gates", () => {
  component("cleanup never hides the primary scenario failure", {
    when: ["running a scenario whose behavior and cleanup both fail", () => {
      const result = spawnSync(
        process.execPath,
        [vitestBin, "run", "test/fixtures/cleanup-aggregate.test.ts"],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, BDD_VITEST_CLEANUP_FAILURE: "1", NO_COLOR: "1" },
        },
      );
      return { result, output: `${result.stdout}\n${result.stderr}` };
    }],
    then: ["both failures and phase labels remain visible", ({ result, output }) => {
      expect(result.status).toBe(1);
      expect(output).toContain("primary broke");
      expect(output).toContain("cleanup broke");
      expect(output).toContain("[unit/then] retains behavior and cleanup failures");
      expect(output).toContain("[unit/cleanup] retains behavior and cleanup failures");
    }],
  });

  component("CLI reporter overrides cannot disable the BDD contract", {
    when: ["running a native test with only the dot reporter", () => {
      const result = runVitest([
        "--root",
        "test/fixtures/reporter-override",
        "--reporter=dot",
      ]);
      return { result, output: `${result.stdout}\n${result.stderr}` };
    }],
    then: ["the worker-side setup gate fails the run", ({ result, output }) => {
      expect(result.status).not.toBe(0);
      expect(output).toContain("bdd-vitest contract violations");
      expect(output).toContain("missing bdd metadata");
    }],
  });

  component("emits the portable bdd.run.v1 catalog", {
    given: ["an isolated report destination", () => mkdtempSync(join(tmpdir(), "bdd-run-"))],
    when: ["running documented and skipped BDD scenarios", (directory) => {
      const outputFile = join(directory, "run.json");
      const args = [
        "--root",
        "test/fixtures/run-report",
      ];
      if (vitestMajor >= 3) args.push("--reporter=dot");
      const result = runVitest(args, {
        BDD_REPORT_FILE: outputFile,
        BDD_REPORT_PROJECT: "checkout",
        BDD_REPORT_REPOSITORY: "adelost/checkout",
        BDD_REPORT_COMMIT_SHA: "0123456789abcdef",
        BDD_REPORT_BRANCH: "main",
        BDD_REPORT_FRAMEWORK_VERSION: "test-version",
      });
      const report = JSON.parse(readFileSync(outputFile, "utf8")) as BddRunReport;
      return { directory, report, result, output: `${result.stdout}\n${result.stderr}` };
    }],
    then: ["the report carries provenance and documented semantic results", ({ report, result, output }) => {
      expect(result.status, output).toBe(0);
      expect(reportValidator(report), reportValidator.errors?.map((error) =>
        `${error.instancePath} ${error.message}`).join("\n")).toBe(true);
      expect(report.schemaVersion).toBe("bdd.run.v1");
      expect(report.run).toMatchObject({
        framework: "vitest",
        frameworkVersion: "test-version",
        project: "checkout",
        repository: "adelost/checkout",
        commitSha: "0123456789abcdef",
        branch: "main",
        status: "passed",
      });
      expect(report.summary).toEqual({ total: 2, passed: 1, failed: 0, skipped: 1, pending: 0 });
      expect(report.tests).toHaveLength(2);
      expect(report.tests.every(({ file }) =>
        file === "test/fixtures/run-report/catalog.test.ts")).toBe(true);
      expect(report.tests.every(({ id }) => /^sha256:[0-9a-f]{64}$/u.test(id))).toBe(true);
      expect(report.tests.every(({ retryCount, flaky }) =>
        retryCount === 0 && flaky === false)).toBe(true);
      expect(report.tests.map(({ level, documentation, status }) => ({
        level,
        documentation,
        status,
      }))).toEqual([
        { level: "unit", documentation: "scenario", status: "passed" },
        { level: "component", documentation: "scenario", status: "skipped" },
      ]);
      expect(report.tests[0]?.scenarios).toEqual([{
        name: "applies discount over 500kr",
        phases: {
          given: "a cart totaling 600kr",
          when: "applying a ten percent discount",
          then: "the total is 540kr",
        },
        documented: true,
      }]);
    }],
    cleanup: (directory) => rmSync(directory, { recursive: true, force: true }),
  });

  component("reports failures without embedding diagnostics", {
    given: ["an isolated report destination", () => mkdtempSync(join(tmpdir(), "bdd-run-"))],
    when: ["running a failing documented scenario", (directory) => {
      const outputFile = join(directory, "run.json");
      const result = runVitest([
        "--root",
        "test/fixtures/run-report",
      ], {
        BDD_REPORT_FILE: outputFile,
        BDD_REPORT_FAILURE: "1",
      });
      const rawReport = readFileSync(outputFile, "utf8");
      return {
        directory,
        rawReport,
        report: JSON.parse(rawReport) as BddRunReport,
        result,
      };
    }],
    then: ["only the failed status is present in the portable artifact", ({
      rawReport,
      report,
      result,
    }) => {
      expect(result.status).not.toBe(0);
      expect(reportValidator(report), reportValidator.errors?.map((error) =>
        `${error.instancePath} ${error.message}`).join("\n")).toBe(true);
      expect(report.run.status).toBe("failed");
      expect(report.summary).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1, pending: 0 });
      expect(report.tests.find(({ status }) => status === "failed")).toMatchObject({
        level: "unit",
        retryCount: 1,
        flaky: false,
      });
      expect(rawReport).not.toContain("SENSITIVE_FAILURE_DETAIL");
    }],
    cleanup: (directory) => rmSync(directory, { recursive: true, force: true }),
  });

  component("derives flaky from a final pass after retry", {
    given: ["an isolated report destination", () => mkdtempSync(join(tmpdir(), "bdd-run-"))],
    when: ["running a scenario that succeeds on retry", (directory) => {
      const outputFile = join(directory, "run.json");
      const result = runVitest([
        "--root",
        "test/fixtures/run-report",
      ], {
        BDD_REPORT_FILE: outputFile,
        BDD_REPORT_FLAKY: "1",
      });
      return {
        directory,
        report: JSON.parse(readFileSync(outputFile, "utf8")) as BddRunReport,
        result,
      };
    }],
    then: ["the final pass is marked flaky consistently", ({ report, result }) => {
      expect(result.status).toBe(0);
      expect(report.run.status).toBe("passed");
      expect(report.tests.find(({ retryCount }) => retryCount > 0)).toMatchObject({
        status: "passed",
        retryCount: 1,
        flaky: true,
      });
    }],
    cleanup: (directory) => rmSync(directory, { recursive: true, force: true }),
  });

  integration("termination signals kill tracked service processes", {
    when: ["signalling a Vitest worker with a running service", () => {
      const result = runVitest([
        "--root",
        "test/fixtures/service-signal",
        "--reporter=dot",
      ]);
      const output = `${result.stdout}\n${result.stderr}`;
      const match = output.match(/BDD_SERVICE_PID=(\d+)/);
      return { result, output, servicePid: match ? Number(match[1]) : null };
    }],
    then: ["the worker fails closed without leaving the service alive", ({
      result,
      output,
      servicePid,
    }) => {
      expect(result.status).not.toBe(0);
      expect(servicePid, output).not.toBeNull();
      if (servicePid === null) return;
      try {
        expect(isProcessAlive(servicePid), output).toBe(false);
      } finally {
        if (isProcessAlive(servicePid)) process.kill(servicePid, "SIGKILL");
      }
    }],
  });
});
