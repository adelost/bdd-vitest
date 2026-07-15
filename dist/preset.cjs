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
var import_node_path = require("path");
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

// src/preset.ts
function contractSetupFile() {
  const projectRequire = (0, import_node_module.createRequire)((0, import_node_path.resolve)(process.cwd(), "__bdd-vitest-resolver.cjs"));
  const presetFile = projectRequire.resolve("bdd-vitest/preset");
  return (0, import_node_path.resolve)((0, import_node_path.dirname)(presetFile), "contract-setup.js");
}
function bddConfig(overrides = {}, contract = {}) {
  const { test: testOverrides = {}, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === void 0 ? ["default"] : Array.isArray(testOverrides.reporters) ? testOverrides.reporters : [testOverrides.reporters];
  const configuredSetupFiles = testOverrides.setupFiles === void 0 ? [] : Array.isArray(testOverrides.setupFiles) ? testOverrides.setupFiles : [testOverrides.setupFiles];
  const resolvedContract = resolveBddContractOptions(contract);
  return (0, import_config.defineConfig)({
    ...rootOverrides,
    test: {
      // Sensible defaults for service-based tests
      testTimeout: 3e4,
      hookTimeout: 2e4,
      // Run unit tests first (fast feedback)
      sequence: {
        concurrent: false
      },
      ...testOverrides,
      reporters: [...configuredReporters, bddContractReporter(contract)],
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
