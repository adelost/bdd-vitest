/**
 * Vitest config preset for bdd-vitest projects.
 *
 * Usage in vitest.config.ts:
 *   import { bddConfig } from "bdd-vitest/preset";
 *   export default bddConfig({
 *     // your overrides
 *   });
 */

import { defineConfig, type UserConfig } from "vitest/config";
import { bddContractReporter, type BddContractOptions } from "./contract.js";

/**
 * Vitest config with BDD contracts enabled. Native `it`/`test` cases are
 * rejected by default; pass `{ policy: "warn" }` during a staged migration.
 */
export function bddConfig(
  overrides: UserConfig = {},
  contract: BddContractOptions = {},
) {
  const { test: testOverrides = {}, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === undefined
    ? ["default" as const]
    : Array.isArray(testOverrides.reporters)
      ? testOverrides.reporters
      : [testOverrides.reporters];

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
    },
  });
}
