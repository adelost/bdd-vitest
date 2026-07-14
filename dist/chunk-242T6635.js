// src/contract.ts
function metadataViolation(name, meta, requirePhaseDescriptions) {
  const bdd = meta?.bdd;
  if (!bdd || typeof bdd !== "object") {
    return `${name}: missing bdd metadata (use unit/component/integration/e2e)`;
  }
  const metadata = bdd;
  if (metadata.version !== 1) return `${name}: unsupported bdd metadata version`;
  if (!["unit", "component", "integration", "e2e"].includes(metadata.level)) {
    return `${name}: invalid bdd level`;
  }
  if (typeof metadata.scenario !== "string" || !metadata.scenario.trim()) {
    return `${name}: missing scenario description`;
  }
  if (!metadata.phases || typeof metadata.phases !== "object") {
    return `${name}: missing phase descriptions`;
  }
  if (typeof metadata.phases.then !== "string" || !metadata.phases.then.trim()) {
    return `${name}: missing then description`;
  }
  for (const phase of ["given", "when"]) {
    const description = metadata.phases[phase];
    if (description !== void 0 && (typeof description !== "string" || !description.trim())) {
      return `${name}: invalid ${phase} description`;
    }
  }
  if (requirePhaseDescriptions && !metadata.documented) {
    return `${name}: outline phases need explicit descriptions`;
  }
  return void 0;
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
function collectLegacyTests(task) {
  const children = task.tasks?.flatMap(collectLegacyTests) ?? [];
  return task.type === "test" ? [task, ...children] : children;
}
function bddContractReporter(options = {}) {
  const policy = options.policy ?? "error";
  const requirePhaseDescriptions = options.requirePhaseDescriptions ?? true;
  const checkedModules = /* @__PURE__ */ new Set();
  const reporter = {
    onTestModuleCollected(module) {
      if (checkedModules.has(module.moduleId)) return;
      checkedModules.add(module.moduleId);
      const violations = [...module.children.allTests()].map((test) => metadataViolation(
        test.fullName,
        test.meta(),
        requirePhaseDescriptions
      )).filter((violation) => violation !== void 0);
      emitViolations(violations, policy);
    },
    onCollected(files) {
      for (const file of files) {
        const moduleId = file.filepath;
        if (moduleId && checkedModules.has(moduleId)) continue;
        if (moduleId) checkedModules.add(moduleId);
        const violations = collectLegacyTests(file).map((test) => metadataViolation(test.name ?? "unnamed test", test.meta, requirePhaseDescriptions)).filter((violation) => violation !== void 0);
        emitViolations(violations, policy);
      }
    }
  };
  return reporter;
}

export {
  bddContractReporter
};
