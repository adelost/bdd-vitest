/**
 * Vitest config preset for bdd-vitest projects.
 *
 * Usage in vitest.config.ts:
 *   import { bddConfig } from "bdd-vitest/preset";
 *   export default bddConfig({
 *     // your overrides
 *   });
 */

import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { defineConfig, type ViteUserConfig } from "vitest/config";
import {
  BDD_CONTRACT_CONTEXT_KEY,
  bddContractReporter,
  resolveBddContractOptions,
  type BddContractOptions,
} from "./contract.js";

function contractSetupFile(): string {
  const projectRequire = createRequire(resolve(process.cwd(), "__bdd-vitest-resolver.cjs"));
  const presetFile = projectRequire.resolve("bdd-vitest/preset");
  return resolve(dirname(presetFile), "contract-setup.js");
}

/**
 * Vitest config with BDD contracts enabled. Native `it`/`test` cases are
 * rejected by default; set either policy to `warn` during a staged migration.
 */
export function bddConfig(
  overrides: ViteUserConfig = {},
  contract: BddContractOptions = {},
) {
  const { test: testOverrides = {}, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === undefined
    ? ["default" as const]
    : Array.isArray(testOverrides.reporters)
      ? testOverrides.reporters
      : [testOverrides.reporters];
  const configuredSetupFiles = testOverrides.setupFiles === undefined
    ? []
    : Array.isArray(testOverrides.setupFiles)
      ? testOverrides.setupFiles
      : [testOverrides.setupFiles];
  const resolvedContract = resolveBddContractOptions(contract);

  return defineConfig({
    ...rootOverrides,
    test: {
      // Sensible defaults for service-based tests
      testTimeout: 30_000,
      hookTimeout: 20_000,
      // Run unit tests first (fast feedback)
      sequence: {
        concurrent: false,
      },
      ...testOverrides,
      reporters: [...configuredReporters, bddContractReporter(contract)],
      setupFiles: [contractSetupFile(), ...configuredSetupFiles],
      provide: {
        ...testOverrides.provide,
        [BDD_CONTRACT_CONTEXT_KEY]: resolvedContract,
      },
    },
  });
}
