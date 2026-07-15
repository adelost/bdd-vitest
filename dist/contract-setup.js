import {
  BDD_CONTRACT_CONTEXT_KEY,
  enforceRuntimeViolations,
  metadataViolations,
  resolveBddContractOptions
} from "./chunk-2NHCFVU7.js";

// src/contract-setup.ts
import { beforeAll, beforeEach, inject } from "vitest";
var injectedOptions = inject(BDD_CONTRACT_CONTEXT_KEY);
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
beforeAll(validateCollectedTree);
beforeEach((context) => {
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
