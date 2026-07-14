import type { Reporter } from "vitest/reporters";
import type { TestModule } from "vitest/node";

export type BddContractPolicy = "off" | "warn" | "error";

export interface BddContractOptions {
  /** Enforce that tests are registered through exactly one BDD level runner. */
  levelPolicy?: BddContractPolicy;
  /** Enforce scenario and phase documentation. */
  documentationPolicy?: BddContractPolicy;
  /** @deprecated Use levelPolicy. */
  policy?: BddContractPolicy;
  /** @deprecated Use documentationPolicy (false maps to off). */
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

interface ContractViolation {
  kind: "level" | "documentation";
  message: string;
}

function levelViolation(message: string): ContractViolation {
  return { kind: "level", message };
}

function documentationViolation(message: string): ContractViolation {
  return { kind: "documentation", message };
}

function metadataViolations(
  name: string,
  meta: Record<string, unknown> | undefined,
  requirePhaseDescriptions: boolean,
): ContractViolation[] {
  const bdd = meta?.bdd;
  if (!bdd || typeof bdd !== "object") {
    return [
      levelViolation(`${name}: missing bdd metadata (use unit/component/integration/e2e)`),
      documentationViolation(`${name}: missing bdd scenario and phase documentation`),
    ];
  }
  const metadata = bdd as Partial<BddTestMetadata>;
  const violations: ContractViolation[] = [];
  if (metadata.version !== 1) {
    violations.push(levelViolation(`${name}: unsupported bdd metadata version`));
  }
  if (!(["unit", "component", "integration", "e2e"] as unknown[]).includes(metadata.level)) {
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
    for (const phase of ["given", "when"] as const) {
      const description = metadata.phases[phase];
      if (description !== undefined && (typeof description !== "string" || !description.trim())) {
        violations.push(documentationViolation(`${name}: invalid ${phase} description`));
      }
    }
  }
  if (requirePhaseDescriptions && !metadata.documented) {
    violations.push(documentationViolation(`${name}: outline phases need explicit descriptions`));
  }
  return violations;
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

function validatePolicy(value: unknown, label: string): BddContractPolicy {
  if (value === "off" || value === "warn" || value === "error") return value;
  throw new Error(`${label} must be one of: off, warn, error`);
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
  const levelPolicy = validatePolicy(
    options.levelPolicy ?? options.policy ?? "error",
    "levelPolicy",
  );
  const documentationPolicy = validatePolicy(
    options.documentationPolicy
      ?? (options.requirePhaseDescriptions === false ? "off" : "error"),
    "documentationPolicy",
  );
  const requirePhaseDescriptions = documentationPolicy !== "off";
  const checkedModules = new Set<string>();

  const report = (violations: ContractViolation[]) => {
    emitViolations(
      violations.filter(({ kind }) => kind === "level").map(({ message }) => message),
      levelPolicy,
    );
    emitViolations(
      violations.filter(({ kind }) => kind === "documentation").map(({ message }) => message),
      documentationPolicy,
    );
  };

  const reporter = {
    onTestModuleCollected(module: TestModule) {
      if (checkedModules.has(module.moduleId)) return;
      checkedModules.add(module.moduleId);
      const violations = [...module.children.allTests()]
        .flatMap((test) => metadataViolations(
          test.fullName,
          test.meta() as unknown as Record<string, unknown>,
          requirePhaseDescriptions,
        ));
      report(violations);
    },
    onCollected(files: LegacyTask[]) {
      for (const file of files) {
        const moduleId = (file as LegacyTask & { filepath?: string }).filepath;
        if (moduleId && checkedModules.has(moduleId)) continue;
        if (moduleId) checkedModules.add(moduleId);
        const violations = collectLegacyTests(file)
          .flatMap((test) => metadataViolations(
            test.name ?? "unnamed test",
            test.meta,
            requirePhaseDescriptions,
          ));
        report(violations);
      }
    },
  };
  // Vitest 2's Reporter type does not declare the modern hook, while Vitest
  // 4 still executes the legacy hook for compatibility. Keep both at runtime
  // and cast only at this version boundary.
  return reporter as unknown as Reporter;
}
