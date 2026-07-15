import {
  BDD_CONTRACT_CONTEXT_KEY,
  bddContractReporter,
  resolveBddContractOptions
} from "./chunk-2NHCFVU7.js";

// src/preset.ts
import { createRequire } from "module";
import { dirname, resolve } from "path";
import { defineConfig } from "vitest/config";
function contractSetupFile() {
  const projectRequire = createRequire(resolve(process.cwd(), "__bdd-vitest-resolver.cjs"));
  const presetFile = projectRequire.resolve("bdd-vitest/preset");
  return resolve(dirname(presetFile), "contract-setup.js");
}
function bddConfig(overrides = {}, contract = {}) {
  const { test: testOverrides = {}, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === void 0 ? ["default"] : Array.isArray(testOverrides.reporters) ? testOverrides.reporters : [testOverrides.reporters];
  const configuredSetupFiles = testOverrides.setupFiles === void 0 ? [] : Array.isArray(testOverrides.setupFiles) ? testOverrides.setupFiles : [testOverrides.setupFiles];
  const resolvedContract = resolveBddContractOptions(contract);
  return defineConfig({
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
export {
  bddConfig
};
