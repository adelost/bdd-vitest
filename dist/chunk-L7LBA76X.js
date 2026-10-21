// src/report.ts
import { createHash } from "crypto";
import { basename, isAbsolute, join as join2, relative, resolve as resolve2, sep } from "path";
import { fileURLToPath } from "url";

// src/report-directory.ts
import { execFileSync } from "child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
function runGit(root) {
  const read = (...args) => execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2e3
  }).trim();
  try {
    return {
      sha: read("rev-parse", "HEAD"),
      branch: read("branch", "--show-current") || null,
      clean: read("status", "--porcelain").length === 0,
      directory: join(resolve(root, read("rev-parse", "--git-common-dir")), "bdd-runs")
    };
  } catch {
    return { sha: null, branch: null, clean: false, directory: null };
  }
}
function writeRunReport(target, report) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(report, null, 2)}
`, "utf8");
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}
function pruneRunReports(directory) {
  const files = [];
  for (const name of readdirSync(directory).filter((name2) => /^\d+-\d+\.json$/u.test(name2)).sort()) {
    try {
      const path = join(directory, name);
      files.push({ path, size: statSync(path).size });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (let index = 0; index < files.length && (files.length - index > 200 || bytes > 5e8); index++) {
    rmSync(files[index].path, { force: true });
    bytes -= files[index].size;
  }
}

// src/report.ts
var BDD_RUN_SCHEMA_VERSION = "bdd.run.v1";
var optionalText = (value) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};
var runtimeValue = (task, key) => {
  const value = task[key];
  return typeof value === "function" ? value.call(task) : value;
};
var numberValue = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
var statusValue = (value, mode) => {
  if (value === "passed" || value === "pass") return "passed";
  if (value === "failed" || value === "fail") return "failed";
  if (value === "skipped" || value === "skip" || value === "todo") return "skipped";
  if (mode === "skip" || mode === "todo") return "skipped";
  return "pending";
};
var portablePath = (root, value) => {
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
var testId = (file, fullName) => `sha256:${createHash("sha256").update(`vitest\0${file.normalize("NFC")}\0${fullName.normalize("NFC")}`).digest("hex")}`;
var bddMetadata = (task) => {
  const metadata = runtimeValue(task, "meta")?.bdd;
  if (!metadata || typeof metadata !== "object") return null;
  return metadata;
};
var reportTest = (task, file, fullName) => {
  const metadata = bddMetadata(task);
  const result = runtimeValue(task, "result");
  const diagnostic = task.diagnostic?.();
  const durationMs = numberValue(diagnostic?.duration ?? result?.duration);
  const retryCount = numberValue(diagnostic?.retryCount ?? result?.retryCount);
  const status = statusValue(result?.state, task.options?.mode ?? task.mode);
  const scenario = metadata ? [{
    name: metadata.scenario,
    phases: metadata.phases,
    documented: metadata.documented,
    ...metadata.outline ? { outline: metadata.outline } : {}
  }] : [];
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
    measuredMs: metadata?.measuredMs ?? null
  };
};
var collectModernTests = (modules, root) => modules.flatMap((entry) => {
  const module = entry;
  const file = portablePath(root, module.moduleId ?? module.filepath ?? "unknown");
  const tests = module.children?.allTests?.();
  if (!tests) return [];
  return [...tests].map((test) => reportTest(
    test,
    file,
    test.fullName?.trim() || test.name?.trim() || "unnamed test"
  ));
});
var collectLegacyTests = (task, file, parents = []) => {
  const name = task.name?.trim() || "unnamed test";
  const nextParents = task.type === "suite" ? [...parents, name] : parents;
  const current = task.type === "test" ? [reportTest(task, file, [...parents, name].join(" > "))] : [];
  return [
    ...current,
    ...task.tasks?.flatMap((child) => collectLegacyTests(
      child,
      file,
      nextParents
    )) ?? []
  ];
};
var reportSummary = (tests) => ({
  total: tests.length,
  passed: tests.filter(({ status }) => status === "passed").length,
  failed: tests.filter(({ status }) => status === "failed").length,
  skipped: tests.filter(({ status }) => status === "skipped").length,
  pending: tests.filter(({ status }) => status === "pending").length
});
function bddRunReporter(options) {
  if (!options.outputFile?.trim() && !options.directory) throw new Error("bddRunReporter requires outputFile or directory");
  const root = resolve2(options.root ?? process.cwd());
  let initialGit = options.directory ? runGit(root) : null;
  let startedAt = Date.now();
  let written = false;
  let frameworkVersion = optionalText(
    options.frameworkVersion ?? process.env.BDD_REPORT_FRAMEWORK_VERSION
  );
  const write = (tests, status) => {
    if (written) return;
    written = true;
    const finishedAt = Date.now();
    const sortedTests = [...tests].sort((left, right) => left.file.localeCompare(right.file) || left.fullName.localeCompare(right.fullName));
    const schemaVersion = options.schemaVersion ?? process.env.BDD_REPORT_SCHEMA ?? (options.directory ? "bdd.run.v2" : BDD_RUN_SCHEMA_VERSION);
    const finalGit = options.directory ? runGit(root) : null;
    const report = {
      schemaVersion,
      run: {
        framework: "vitest",
        frameworkVersion,
        project: optionalText(options.project ?? process.env.BDD_REPORT_PROJECT),
        repository: optionalText(options.repository ?? process.env.BDD_REPORT_REPOSITORY),
        commitSha: initialGit ? initialGit.clean && finalGit?.clean && initialGit.sha === finalGit.sha ? initialGit.sha : null : optionalText(options.commitSha ?? process.env.BDD_REPORT_COMMIT_SHA ?? process.env.GITHUB_SHA),
        branch: initialGit ? initialGit.branch : optionalText(options.branch ?? process.env.BDD_REPORT_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME),
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        status
      },
      summary: reportSummary(sortedTests),
      tests: schemaVersion === "bdd.run.v2" ? sortedTests : sortedTests.map(({ budget: _budget, measuredMs: _measured, ...test }) => test)
    };
    try {
      if (schemaVersion !== "bdd.run.v1" && schemaVersion !== "bdd.run.v2") throw new Error("unsupported report schema");
      if (options.outputFile) writeRunReport(resolve2(options.outputFile), report);
      if (options.directory) {
        const directory = initialGit?.directory;
        if (!directory) throw new Error("git common directory unavailable");
        writeRunReport(join2(directory, `${startedAt}-${process.pid}.json`), { ...report, schemaVersion: "bdd.run.v2", tests: sortedTests });
        pruneRunReports(directory);
      }
    } catch (error) {
      console.warn(`[bdd-vitest] report write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const reporter = {
    onInit(context) {
      frameworkVersion ??= optionalText(context.version);
    },
    onTestRunStart() {
      startedAt = Date.now();
      initialGit = options.directory ? runGit(root) : null;
      written = false;
    },
    onTestRunEnd(modules, errors, reason) {
      const tests = collectModernTests(modules, root);
      const status = reason === "interrupted" ? "interrupted" : reason === "failed" || errors.length > 0 || tests.some(({ status: status2 }) => status2 === "failed") ? "failed" : "passed";
      write(tests, status);
    },
    onFinished(files, errors) {
      const tests = files.flatMap((file) => {
        const path = portablePath(root, file.filepath ?? file.moduleId ?? "unknown");
        return collectLegacyTests(file, path);
      });
      write(
        tests,
        errors.length > 0 || tests.some(({ status }) => status === "failed") ? "failed" : "passed"
      );
    }
  };
  return reporter;
}

export {
  BDD_RUN_SCHEMA_VERSION,
  bddRunReporter
};
