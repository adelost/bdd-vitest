"use strict";

// src/contract-setup.ts
var import_vitest = require("vitest");

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
function formatViolations(violations) {
  return [
    "bdd-vitest contract violations:",
    ...violations.map((violation) => `- ${violation}`)
  ].join("\n");
}
function enforceRuntimeViolations(violations, options) {
  const warnings = violations.filter(({ kind }) => options[`${kind}Policy`] === "warn").map(({ message }) => message);
  const errors = violations.filter(({ kind }) => options[`${kind}Policy`] === "error").map(({ message }) => message);
  if (warnings.length > 0) console.warn(formatViolations(warnings));
  if (errors.length > 0) throw new Error(formatViolations(errors));
}

// src/contract-setup.ts
var injectedOptions = (0, import_vitest.inject)(BDD_CONTRACT_CONTEXT_KEY);
if (!injectedOptions) {
  throw new Error("bdd-vitest contract setup must be installed through bddConfig()");
}
var contractOptions = resolveBddContractOptions(injectedOptions);
var checkedTasks = /* @__PURE__ */ new WeakSet();
function taskMetadata(task) {
  return typeof task.meta === "function" ? task.meta() : task.meta;
}
function collectViolations(task, parents = []) {
  const taskName = task.name?.trim() || "unnamed test";
  if (task.type === "test") {
    checkedTasks.add(task);
    return metadataViolations(
      [...parents, taskName].join(" > "),
      taskMetadata(task),
      contractOptions.requirePhaseDescriptions
    );
  }
  const nextParents = task.type === "suite" && task.name ? [...parents, taskName] : parents;
  return task.tasks?.flatMap((child) => collectViolations(child, nextParents)) ?? [];
}
function validateCollectedTree({}, suite) {
  const collectedTree = suite ?? arguments[0];
  enforceRuntimeViolations(
    collectViolations(collectedTree),
    contractOptions
  );
}
(0, import_vitest.beforeAll)(validateCollectedTree);
(0, import_vitest.beforeEach)((context) => {
  const task = context.task;
  if (checkedTasks.has(task)) return;
  checkedTasks.add(task);
  enforceRuntimeViolations(
    metadataViolations(
      task.name?.trim() || "unnamed test",
      taskMetadata(task),
      contractOptions.requirePhaseDescriptions
    ),
    contractOptions
  );
});
