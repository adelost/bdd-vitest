import { beforeAll, beforeEach, inject } from "vitest";
import {
  BDD_CONTRACT_CONTEXT_KEY,
  enforceRuntimeViolations,
  metadataViolations,
  resolveBddContractOptions,
  type ContractViolation,
  type ResolvedBddContractOptions,
} from "./contract.js";

interface RuntimeTask {
  type?: string;
  name?: string;
  meta?: Record<string, unknown> | (() => Record<string, unknown>);
  tasks?: RuntimeTask[];
}

const injectedOptions = (inject as unknown as (
  key: string,
) => ResolvedBddContractOptions | undefined)(BDD_CONTRACT_CONTEXT_KEY);

if (!injectedOptions) {
  throw new Error("bdd-vitest contract setup must be installed through bddConfig()");
}

const contractOptions = resolveBddContractOptions(injectedOptions);
const checkedTasks = new WeakSet<object>();

function taskMetadata(task: RuntimeTask): Record<string, unknown> | undefined {
  return typeof task.meta === "function" ? task.meta() : task.meta;
}

function collectViolations(
  task: RuntimeTask,
  parents: string[] = [],
): ContractViolation[] {
  const taskName = task.name?.trim() || "unnamed test";
  if (task.type === "test") {
    checkedTasks.add(task);
    return metadataViolations(
      [...parents, taskName].join(" > "),
      taskMetadata(task),
      contractOptions.requirePhaseDescriptions,
    );
  }

  const nextParents = task.type === "suite" && task.name
    ? [...parents, taskName]
    : parents;
  return task.tasks?.flatMap((child) => collectViolations(child, nextParents)) ?? [];
}

// The file-level hook validates the complete collected tree, including skipped
// tests. The per-test hook is a cross-version fallback for runners that do not
// expose that tree to setup-file hooks.
function validateCollectedTree({}: object, suite?: unknown): void {
  // Vitest 2/3 pass the suite as the first argument. Vitest 4 added a fixture
  // context before it. The empty destructuring pattern is accepted by Vitest
  // 4's fixture parser; `arguments[0]` retains the legacy suite value.
  const collectedTree = suite ?? arguments[0];
  enforceRuntimeViolations(
    collectViolations(collectedTree as RuntimeTask),
    contractOptions,
  );
}

beforeAll(validateCollectedTree as never);

beforeEach((context) => {
  const task = context.task as unknown as RuntimeTask;
  if (checkedTasks.has(task)) return;
  checkedTasks.add(task);
  enforceRuntimeViolations(
    metadataViolations(
      task.name?.trim() || "unnamed test",
      taskMetadata(task),
      contractOptions.requirePhaseDescriptions,
    ),
    contractOptions,
  );
});
