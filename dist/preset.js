import {
  bddContractReporter
} from "./chunk-ENAWRY6E.js";

// src/preset.ts
import { defineConfig } from "vitest/config";
function bddConfig(overrides = {}, contract = {}) {
  const { test: testOverrides = {}, ...rootOverrides } = overrides;
  const configuredReporters = testOverrides.reporters === void 0 ? ["default"] : Array.isArray(testOverrides.reporters) ? testOverrides.reporters : [testOverrides.reporters];
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
      reporters: [...configuredReporters, bddContractReporter(contract)]
    }
  });
}
export {
  bddConfig
};
