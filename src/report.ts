import { createHash } from "node:crypto";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Reporter } from "vitest/reporters";
import type { BddTestMetadata } from "./contract.js";
import { pruneRunReports, runGit, writeRunReport } from "./report-directory.js";

export const BDD_RUN_SCHEMA_VERSION = "bdd.run.v1" as const;

export type BddRunStatus = "passed" | "failed" | "skipped" | "pending";

export interface BddRunScenario {
  name: string;
  phases: BddTestMetadata["phases"];
  documented: boolean;
  outline?: BddTestMetadata["outline"];
}

export interface BddRunTest {
  id: string;
  name: string;
  fullName: string;
  file: string;
  line: number | null;
  level: BddTestMetadata["level"] | null;
  documentation: "scenario" | "docstring" | "missing";
  scenarios: BddRunScenario[];
  status: BddRunStatus;
  durationMs: number;
  retryCount: number;
  flaky: boolean;
  budget?: BddTestMetadata["budget"] | null;
  measuredMs?: number | null;
}

export interface BddRunReport {
  schemaVersion: typeof BDD_RUN_SCHEMA_VERSION | "bdd.run.v2";
  run: {
    framework: "vitest";
    frameworkVersion: string | null;
    project: string | null;
    repository: string | null;
    commitSha: string | null;
    branch: string | null;
    startedAt: string;
    finishedAt: string;
    durationMs: number;
    status: "passed" | "failed" | "interrupted";
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    pending: number;
  };
  tests: BddRunTest[];
}

export interface BddRunReporterOptions {
  outputFile?: string;
  /** Opt in once per repository; writes v2 to git-common-dir/bdd-runs. */
  directory?: boolean;
  schemaVersion?: "bdd.run.v1" | "bdd.run.v2";
  root?: string;
  project?: string;
  repository?: string;
  commitSha?: string;
  branch?: string;
  frameworkVersion?: string;
}

interface RuntimeTask {
  type?: string;
  id?: string;
  name?: string;
  fullName?: string;
  filepath?: string;
  moduleId?: string;
  mode?: string;
  options?: { mode?: string };
  location?: { line?: number };
  meta?: Record<string, unknown> | (() => Record<string, unknown>);
  result?: Record<string, unknown> | (() => Record<string, unknown>);
  diagnostic?: () => Record<string, unknown> | undefined;
  children?: { allTests?: () => Iterable<RuntimeTask> };
  tasks?: RuntimeTask[];
}

const optionalText = (value: string | undefined): string | null => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const runtimeValue = (
  task: RuntimeTask,
  key: "meta" | "result",
): Record<string, unknown> | undefined => {
  const value = task[key];
  return typeof value === "function" ? value.call(task) : value;
};

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

const statusValue = (value: unknown, mode?: string): BddRunStatus => {
  if (value === "passed" || value === "pass") return "passed";
  if (value === "failed" || value === "fail") return "failed";
  if (value === "skipped" || value === "skip" || value === "todo") return "skipped";
  if (mode === "skip" || mode === "todo") return "skipped";
  return "pending";
};

const portablePath = (root: string, value: string): string => {
  const withoutQuery = value.replace(/[?#].*$/u, "");
  let path = withoutQuery;
  if (path.startsWith("file://")) {
    try {
      path = fileURLToPath(path);
    } catch {
      return basename(path);
    }
  }
  const candidate = isAbsolute(path) ? relative(root, path) : path;
  const portable = candidate.split(sep).join("/").replaceAll("\\", "/");
  if (portable === ".." || portable.startsWith("../") || /^[A-Za-z]:\//u.test(portable)) {
    return portable.split("/").at(-1) || "unknown";
  }
  return portable.replace(/^\.\//u, "");
};

const testId = (file: string, fullName: string): string =>
  `sha256:${createHash("sha256")
    .update(`vitest\0${file.normalize("NFC")}\0${fullName.normalize("NFC")}`)
    .digest("hex")}`;

const bddMetadata = (task: RuntimeTask): BddTestMetadata | null => {
  const metadata = runtimeValue(task, "meta")?.bdd;
  if (!metadata || typeof metadata !== "object") return null;
  return metadata as BddTestMetadata;
};

const reportTest = (
  task: RuntimeTask,
  file: string,
  fullName: string,
): BddRunTest => {
  const metadata = bddMetadata(task);
  const result = runtimeValue(task, "result");
  const diagnostic = task.diagnostic?.();
  const durationMs = numberValue(diagnostic?.duration ?? result?.duration);
  const retryCount = numberValue(diagnostic?.retryCount ?? result?.retryCount);
  const status = statusValue(result?.state, task.options?.mode ?? task.mode);
  const scenario = metadata
    ? [{
        name: metadata.scenario,
        phases: metadata.phases,
        documented: metadata.documented,
        ...(metadata.outline ? { outline: metadata.outline } : {}),
      }]
    : [];

  return {
    id: testId(file, fullName),
    name: task.name?.trim() || "unnamed test",
    fullName,
    file,
    line: typeof task.location?.line === "number" ? task.location.line : null,
    level: metadata?.level ?? null,
    documentation: metadata?.documented ? "scenario" : "missing",
    scenarios: scenario,
    status,
    durationMs,
    retryCount,
    flaky: retryCount > 0 && status === "passed",
    budget: metadata?.budget ?? null,
    measuredMs: metadata?.measuredMs ?? null,
  };
};

const collectModernTests = (modules: readonly unknown[], root: string): BddRunTest[] =>
  modules.flatMap((entry) => {
    const module = entry as RuntimeTask;
    const file = portablePath(root, module.moduleId ?? module.filepath ?? "unknown");
    const tests = module.children?.allTests?.();
    if (!tests) return [];
    return [...tests].map((test) => reportTest(
      test,
      file,
      test.fullName?.trim() || test.name?.trim() || "unnamed test",
    ));
  });

const collectLegacyTests = (
  task: RuntimeTask,
  file: string,
  parents: string[] = [],
): BddRunTest[] => {
  const name = task.name?.trim() || "unnamed test";
  const nextParents = task.type === "suite" ? [...parents, name] : parents;
  const current = task.type === "test"
    ? [reportTest(task, file, [...parents, name].join(" > "))]
    : [];
  return [
    ...current,
    ...(task.tasks?.flatMap((child) => collectLegacyTests(
      child,
      file,
      nextParents,
    )) ?? []),
  ];
};

const reportSummary = (tests: BddRunTest[]): BddRunReport["summary"] => ({
  total: tests.length,
  passed: tests.filter(({ status }) => status === "passed").length,
  failed: tests.filter(({ status }) => status === "failed").length,
  skipped: tests.filter(({ status }) => status === "skipped").length,
  pending: tests.filter(({ status }) => status === "pending").length,
});

/**
 * Emit the portable `bdd.run.v1` catalog consumed by Suggestions and other CI
 * tooling. The report deliberately excludes console output and stack traces.
 */
export function bddRunReporter(options: BddRunReporterOptions): Reporter {
  if (!options.outputFile?.trim() && !options.directory) throw new Error("bddRunReporter requires outputFile or directory");
  const root = resolve(options.root ?? process.cwd());
  let initialGit = options.directory ? runGit(root) : null;
  let startedAt = Date.now();
  let written = false;
  let frameworkVersion = optionalText(
    options.frameworkVersion ?? process.env.BDD_REPORT_FRAMEWORK_VERSION,
  );

  const write = (
    tests: BddRunTest[],
    status: BddRunReport["run"]["status"],
  ): void => {
    if (written) return;
    written = true;
    const finishedAt = Date.now();
    const sortedTests = [...tests].sort((left, right) =>
      left.file.localeCompare(right.file) || left.fullName.localeCompare(right.fullName));
    const schemaVersion = options.schemaVersion ?? process.env.BDD_REPORT_SCHEMA
      ?? (options.directory ? "bdd.run.v2" : BDD_RUN_SCHEMA_VERSION);
    const finalGit = options.directory ? runGit(root) : null;
    const report: BddRunReport = {
      schemaVersion: schemaVersion as BddRunReport["schemaVersion"],
      run: {
        framework: "vitest",
        frameworkVersion,
        project: optionalText(options.project ?? process.env.BDD_REPORT_PROJECT),
        repository: optionalText(options.repository ?? process.env.BDD_REPORT_REPOSITORY),
        commitSha: initialGit
          ? initialGit.clean && finalGit?.clean && initialGit.sha === finalGit.sha ? initialGit.sha : null
          : optionalText(options.commitSha ?? process.env.BDD_REPORT_COMMIT_SHA ?? process.env.GITHUB_SHA),
        branch: initialGit ? initialGit.branch
          : optionalText(options.branch ?? process.env.BDD_REPORT_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME),
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        status,
      },
      summary: reportSummary(sortedTests),
      tests: schemaVersion === "bdd.run.v2" ? sortedTests : sortedTests.map(({ budget: _budget, measuredMs: _measured, ...test }) => test),
    };
    try {
      if (schemaVersion !== "bdd.run.v1" && schemaVersion !== "bdd.run.v2") throw new Error("unsupported report schema");
      if (options.outputFile) writeRunReport(resolve(options.outputFile), report);
      if (options.directory) {
        const directory = initialGit?.directory;
        if (!directory) throw new Error("git common directory unavailable");
        // Catalog files are v2 even when an explicit legacy output file was requested.
        writeRunReport(join(directory, `${startedAt}-${process.pid}.json`), { ...report, schemaVersion: "bdd.run.v2", tests: sortedTests });
        pruneRunReports(directory);
      }
    } catch (error) {
      console.warn(`[bdd-vitest] report write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const reporter = {
    onInit(context: { version?: string }) {
      frameworkVersion ??= optionalText(context.version);
    },
    onTestRunStart() {
      startedAt = Date.now();
      initialGit = options.directory ? runGit(root) : null;
      written = false;
    },
    onTestRunEnd(modules: readonly unknown[], errors: readonly unknown[], reason: string) {
      const tests = collectModernTests(modules, root);
      const status = reason === "interrupted"
        ? "interrupted"
        : reason === "failed" || errors.length > 0 || tests.some(({ status }) => status === "failed")
          ? "failed"
          : "passed";
      write(tests, status);
    },
    onFinished(files: RuntimeTask[], errors: unknown[]) {
      const tests = files.flatMap((file) => {
        const path = portablePath(root, file.filepath ?? file.moduleId ?? "unknown");
        return collectLegacyTests(file, path);
      });
      write(
        tests,
        errors.length > 0 || tests.some(({ status }) => status === "failed")
          ? "failed"
          : "passed",
      );
    },
  };
  return reporter as unknown as Reporter;
}
