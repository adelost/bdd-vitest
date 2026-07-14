import { ViteUserConfig } from 'vitest/config';
import { BddContractOptions } from './contract.cjs';
import 'vitest/reporters';

/**
 * Vitest config preset for bdd-vitest projects.
 *
 * Usage in vitest.config.ts:
 *   import { bddConfig } from "bdd-vitest/preset";
 *   export default bddConfig({
 *     // your overrides
 *   });
 */

/**
 * Vitest config with BDD contracts enabled. Native `it`/`test` cases are
 * rejected by default; set either policy to `warn` during a staged migration.
 */
declare function bddConfig(overrides?: ViteUserConfig, contract?: BddContractOptions): ViteUserConfig;

export { bddConfig };
