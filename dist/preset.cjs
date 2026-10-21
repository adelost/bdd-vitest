"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/preset.ts
var preset_exports = {};
__export(preset_exports, {
  bddConfig: () => bddConfig
});
module.exports = __toCommonJS(preset_exports);
var import_node_module = require("module");
var import_node_path3 = require("path");
var import_config = require("vitest/config");

// src/contract.ts
var BDD_CONTRACT_CONTEXT_KEY = "bdd-vitest.contract.v1";
function levelViolation(message) {
  return { kind: "level", message };
}
function documentationViolation(message) {
  return { kind: "documentation", message };
}
function metadataViolations(name, meta, requirePhaseDescriptions) {
  const bdd = meta?.bdd;
  if (!bdd || typeof bdd !== "object") {
    return [
      levelViolation(`${name}: missing bdd metadata (use unit/component/integration/e2e)`),
      documentationViolation(`${name}: missing bdd scenario and phase documentation`)
    ];
  }
  const metadata = bdd;
  const violations = [];
  if (metadata.version !== 1) {
    violations.push(levelViolation(`${name}: unsupported bdd metadata version`));
  }
  if (!["unit", "component", "integration", "e2e"].includes(metadata.level)) {
    violations.push(levelViolation(`${name}: invalid bdd level`));
  }
  if (typeof metadata.scenario !== "string" || !metadata.scenario.trim()) {
    violations.push(documentationViolation(`${name}: missing scenario description`));
  }
  if (!metadata.phases || typeof metadata.phases !== "object") {
    violations.push(documentationViolation(`${name}: missing phase descriptions`));
  } else {
    if (typeof metadata.phases.then !== "string" || !metadata.phases.then.trim()) {
      violations.push(documentationViolation(`${name}: missing then description`));
    }
    for (const phase of ["given", "when"]) {
      const description = metadata.phases[phase];
      if (description !== void 0 && (typeof description !== "string" || !description.trim())) {
        violations.push(documentationViolation(`${name}: invalid ${phase} description`));
      }
    }
  }
  if (requirePhaseDescriptions && !metadata.documented) {
    violations.push(documentationViolation(`${name}: outline phases need explicit descriptions`));
  }
  return violations;
}
function emitViolations(violations, policy) {
  if (policy === "off" || violations.length === 0) return;
  const message = [
    "bdd-vitest contract violations:",
    ...violations.map((violation) => `- ${violation}`)
  ].join("\n");
  if (policy === "warn") {
    console.warn(message);
    return;
  }
  console.error(message);
  process.exitCode = 1;
}
function validatePolicy(value, label) {
  if (value === "off" || value === "warn" || value === "error") return value;
  throw new Error(`${label} must be one of: off, warn, error`);
}
function resolveBddContractOptions(options = {}) {
  const levelPolicy = validatePolicy(
    options.levelPolicy ?? options.policy ?? "error",
    "levelPolicy"
  );
  const documentationPolicy = validatePolicy(
    options.documentationPolicy ?? (options.requirePhaseDescriptions === false ? "off" : "error"),
    "documentationPolicy"
  );
  return {
    levelPolicy,
    documentationPolicy,
    requirePhaseDescriptions: documentationPolicy !== "off"
  };
}
function collectLegacyTests(task) {
  const children = task.tasks?.flatMap(collectLegacyTests) ?? [];
  return task.type === "test" ? [task, ...children] : children;
}
function bddContractReporter(options = {}) {
  const {
    levelPolicy,
    documentationPolicy,
    requirePhaseDescriptions
  } = resolveBddContractOptions(options);
  const checkedModules = /* @__PURE__ */ new Set();
  const report = (violations) => {
    emitViolations(
      violations.filter(({ kind }) => kind === "level").map(({ message }) => message),
      levelPolicy
    );
    emitViolations(
      violations.filter(({ kind }) => kind === "documentation").map(({ message }) => message),
      documentationPolicy
    );
  };
  const reporter = {
    onTestModuleCollected(module2) {
      if (checkedModules.has(module2.moduleId)) return;
      checkedModules.add(module2.moduleId);
      const violations = [...module2.children.allTests()].flatMap((test) => metadataViolations(
        test.fullName,
        test.meta(),
        requirePhaseDescriptions
      ));
      report(violations);
    },
    onCollected(files) {
      for (const file of files) {
        const moduleId = file.filepath;
        if (moduleId && checkedModules.has(moduleId)) continue;
        if (moduleId) checkedModules.add(moduleId);
        const violations = collectLegacyTests(file).flatMap((test) => metadataViolations(
          test.name ?? "unnamed test",
          test.meta,
          requirePhaseDescriptions
        ));
        report(violations);
      }
    }
  };
  return reporter;
}

// src/report.ts
var import_node_crypto = require("crypto");
var import_node_path2 = require("path");
var import_node_url = require("url");

// src/report-directory.ts
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
var import_node_path = require("path");
function runGit(root) {
  const read = (...args) => (0, import_node_child_process.execFileSync)("git", args, {
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
      directory: (0, import_node_path.join)((0, import_node_path.resolve)(root, read("rev-parse", "--git-common-dir")), "bdd-runs")
    };
  } catch {
    return { sha: null, branch: null, clean: false, directory: null };
  }
}
function writeRunReport(target, report) {
  (0, import_node_fs.mkdirSync)((0, import_node_path.dirname)(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`;
  try {
    (0, import_node_fs.writeFileSync)(temporary, `${JSON.stringify(report, null, 2)}
`, "utf8");
    (0, import_node_fs.renameSync)(temporary, target);
  } finally {
    (0, import_node_fs.rmSync)(temporary, { force: true });
  }
}
function pruneRunReports(directory) {
  const files = [];
  for (const name of (0, import_node_fs.readdirSync)(directory).filter((name2) => /^\d+-\d+\.json$/u.test(name2)).sort()) {
    try {
      const path = (0, import_node_path.join)(directory, name);
      files.push({ path, size: (0, import_node_fs.statSync)(path).size });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let bytes = files.reduce((sum, file) => sum + file.size, 0);
  for (let index = 0; index < files.length && (files.length - index > 200 || bytes > 5e8); index++) {
    (0, import_node_fs.rmSync)(files[index].path, { force: true });
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
      path = (0, import_node_url.fileURLToPath)(path);
    } catch {
      return (0, import_node_path2.basename)(path);
    }
  }
  const candidate = (0, import_node_path2.isAbsolute)(path) ? (0, import_node_path2.relative)(root, path) : path;
  const portable = candidate.split(import_node_path2.sep).join("/").replaceAll("\\", "/");
  if (portable === ".." || portable.startsWith("../") || /^[A-Za-z]:\//u.test(portable)) {
    return portable.split("/").at(-1) || "unknown";
  }
  return portable.replace(/^\.\//u, "");
};
var testId = (file, fullName) => `sha256:${(0, import_node_crypto.createHash)("sha256").update(`vitest\0${file.normalize("NFC")}\0${fullName.normalize("NFC")}`).digest("hex")}`;
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
  const module2 = entry;
  const file = portablePath(root, module2.moduleId ?? module2.filepath ?? "unknown");
  const tests = module2.children?.allTests?.();
  if (!tests) return [];
  return [...tests].map((test) => reportTest(
    test,
    file,
    test.fullName?.trim() || test.name?.trim() || "unnamed test"
  ));
});
var collectLegacyTests2 = (task, file, parents = []) => {
  const name = task.name?.trim() || "unnamed test";
  const nextParents = task.type === "suite" ? [...parents, name] : parents;
  const current = task.type === "test" ? [reportTest(task, file, [...parents, name].join(" > "))] : [];
  return [
    ...current,
    ...task.tasks?.flatMap((child) => collectLegacyTests2(
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
  const root = (0, import_node_path2.resolve)(options.root ?? process.cwd());
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
      if (options.outputFile) writeRunReport((0, import_node_path2.resolve)(options.outputFile), report);
      if (options.directory) {
        const directory = initialGit?.directory;
        if (!directory) throw new Error("git common directory unavailable");
        writeRunReport((0, import_node_path2.join)(directory, `${startedAt}-${process.pid}.json`), { ...report, schemaVersion: "bdd.run.v2", tests: sortedTests });
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
        return collectLegacyTests2(file, path);
      });
      write(
        tests,
        errors.length > 0 || tests.some(({ status }) => status === "failed") ? "failed" : "passed"
      );
    }
  };
  return reporter;
}

// src/preset.ts
function contractSetupFile() {
  const projectRequire = (0, import_node_module.createRequire)((0, import_node_path3.resolve)(process.cwd(), "__bdd-vitest-resolver.cjs"));
  const presetFile = projectRequire.resolve("bdd-vitest/preset");
  return (0, import_node_path3.resolve)((0, import_node_path3.dirname)(presetFile), "contract-setup.js");
}
function bddConfig(overrides = {}, contract = {}) {
  const { test: testOverrides = {}, bddReport, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === void 0 ? ["default"] : Array.isArray(testOverrides.reporters) ? testOverrides.reporters : [testOverrides.reporters];
  const configuredSetupFiles = testOverrides.setupFiles === void 0 ? [] : Array.isArray(testOverrides.setupFiles) ? testOverrides.setupFiles : [testOverrides.setupFiles];
  const resolvedContract = resolveBddContractOptions(contract);
  const runReporter = process.env.BDD_REPORT_FILE?.trim() || bddReport?.directory ? bddRunReporter({ outputFile: process.env.BDD_REPORT_FILE, directory: bddReport?.directory, root: overrides.root }) : null;
  const runReport = runReporter ? [runReporter] : [];
  const runReporterPlugin = runReporter ? {
    name: "bdd-vitest-run-reporter",
    configureVitest({ vitest }) {
      if (!vitest.config.reporters.includes(runReporter)) {
        vitest.config.reporters.push(runReporter);
      }
    }
  } : null;
  return (0, import_config.defineConfig)({
    ...rootOverrides,
    plugins: [
      ...rootOverrides.plugins ?? [],
      ...runReporterPlugin ? [runReporterPlugin] : []
    ],
    test: {
      // Sensible defaults for service-based tests
      testTimeout: 3e4,
      hookTimeout: 2e4,
      // Run unit tests first (fast feedback)
      sequence: {
        concurrent: false
      },
      ...testOverrides,
      reporters: [...configuredReporters, ...runReport, bddContractReporter(contract)],
      setupFiles: [contractSetupFile(), ...configuredSetupFiles],
      provide: {
        ...testOverrides.provide,
        [BDD_CONTRACT_CONTEXT_KEY]: resolvedContract
      }
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  bddConfig
});
