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
    onTestModuleCollected(module) {
      if (checkedModules.has(module.moduleId)) return;
      checkedModules.add(module.moduleId);
      const violations = [...module.children.allTests()].flatMap((test) => metadataViolations(
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

export {
  BDD_CONTRACT_CONTEXT_KEY,
  metadataViolations,
  resolveBddContractOptions,
  enforceRuntimeViolations,
  bddContractReporter
};
