import type { Reporter } from "vitest/reporters";
import type { TestModule } from "vitest/node";

export type BddContractPolicy = "off" | "warn" | "error";

export interface BddContractOptions {
  /** What to do with tests not registered through a BDD level runner. */
  policy?: BddContractPolicy;
  /** Require explicit Given/When/Then descriptions, including outlines. */
  requirePhaseDescriptions?: boolean;
}

export interface BddTestMetadata {
  version: 1;
  level: "unit" | "component" | "integration" | "e2e";
  scenario: string;
  phases: {
    given?: string;
    when?: string;
    then: string;
  };
  documented: boolean;
  outline?: {
    name: string;
    row: string;
  };
}

interface LegacyTask {
  type?: string;
  name?: string;
  meta?: Record<string, unknown>;
  tasks?: LegacyTask[];
}

function metadataViolation(
  name: string,
  meta: Record<string, unknown> | undefined,
  requirePhaseDescriptions: boolean,
): string | undefined {
  const bdd = meta?.bdd;
  if (!bdd || typeof bdd !== "object") {
    return `${name}: missing bdd metadata (use unit/component/integration/e2e)`;
  }
  const metadata = bdd as Partial<BddTestMetadata>;
  if (metadata.version !== 1) return `${name}: unsupported bdd metadata version`;
  if (!(["unit", "component", "integration", "e2e"] as unknown[]).includes(metadata.level)) {
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
  for (const phase of ["given", "when"] as const) {
    const description = metadata.phases[phase];
    if (description !== undefined && (typeof description !== "string" || !description.trim())) {
      return `${name}: invalid ${phase} description`;
    }
  }
  if (requirePhaseDescriptions && !metadata.documented) {
    return `${name}: outline phases need explicit descriptions`;
  }
  return undefined;
}

function emitViolations(violations: string[], policy: BddContractPolicy): void {
  if (policy === "off" || violations.length === 0) return;
  const message = [
    "bdd-vitest contract violations:",
    ...violations.map((violation) => `- ${violation}`),
  ].join("\n");
  if (policy === "warn") {
    console.warn(message);
    return;
  }
  // Reporter hook exceptions were swallowed by Vitest 2 and surfaced as an
  // unhandled rejection by Vitest 4. Setting the exit code is the stable
  // cross-version contract: the run fails without fabricating a test failure.
  console.error(message);
  process.exitCode = 1;
}

function collectLegacyTests(task: LegacyTask): LegacyTask[] {
  const children = task.tasks?.flatMap(collectLegacyTests) ?? [];
  return task.type === "test" ? [task, ...children] : children;
}

/**
 * Reporter enforcing that every collected test carries metadata written by a
 * BDD level runner. Supports the modern Vitest reporter API and Vitest 2's
 * legacy `onCollected` hook.
 */
export function bddContractReporter(options: BddContractOptions = {}): Reporter {
  const policy = options.policy ?? "error";
  const requirePhaseDescriptions = options.requirePhaseDescriptions ?? true;
  const checkedModules = new Set<string>();

  return {
    onTestModuleCollected(module: TestModule) {
      if (checkedModules.has(module.moduleId)) return;
      checkedModules.add(module.moduleId);
      const violations = [...module.children.allTests()]
        .map((test) => metadataViolation(
          test.fullName,
          test.meta() as unknown as Record<string, unknown>,
          requirePhaseDescriptions,
        ))
        .filter((violation): violation is string => violation !== undefined);
      emitViolations(violations, policy);
    },
    onCollected(files) {
      for (const file of files as unknown as LegacyTask[]) {
        const moduleId = (file as LegacyTask & { filepath?: string }).filepath;
        if (moduleId && checkedModules.has(moduleId)) continue;
        if (moduleId) checkedModules.add(moduleId);
        const violations = collectLegacyTests(file)
          .map((test) => metadataViolation(test.name ?? "unnamed test", test.meta, requirePhaseDescriptions))
          .filter((violation): violation is string => violation !== undefined);
        emitViolations(violations, policy);
      }
    },
  };
}
