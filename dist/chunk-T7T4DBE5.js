// src/report.ts
import { createHash } from "crypto";
import { mkdirSync, renameSync, writeFileSync } from "fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "path";
import { fileURLToPath } from "url";
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
    status: statusValue(result?.state, task.options?.mode ?? task.mode),
    durationMs,
    retryCount,
    flaky: diagnostic?.flaky === true || result?.flaky === true
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
var atomicWrite = (outputFile, report) => {
  const target = resolve(outputFile);
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(report, null, 2)}
`, "utf8");
  renameSync(temporary, target);
};
function bddRunReporter(options) {
  if (!options.outputFile?.trim()) throw new Error("bddRunReporter requires outputFile");
  const root = resolve(options.root ?? process.cwd());
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
    atomicWrite(options.outputFile, {
      schemaVersion: BDD_RUN_SCHEMA_VERSION,
      run: {
        framework: "vitest",
        frameworkVersion,
        project: optionalText(options.project ?? process.env.BDD_REPORT_PROJECT),
        repository: optionalText(options.repository ?? process.env.BDD_REPORT_REPOSITORY),
        commitSha: optionalText(options.commitSha ?? process.env.BDD_REPORT_COMMIT_SHA ?? process.env.GITHUB_SHA),
        branch: optionalText(options.branch ?? process.env.BDD_REPORT_BRANCH ?? process.env.GITHUB_HEAD_REF ?? process.env.GITHUB_REF_NAME),
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        durationMs: finishedAt - startedAt,
        status
      },
      summary: reportSummary(sortedTests),
      tests: sortedTests
    });
  };
  const reporter = {
    onInit(context) {
      frameworkVersion ??= optionalText(context.version);
    },
    onTestRunStart() {
      startedAt = Date.now();
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
