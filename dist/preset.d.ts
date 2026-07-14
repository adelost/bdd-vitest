import * as vite from 'vite';
import { UserConfig } from 'vitest/config';
import { BddContractOptions } from './contract.js';
import 'vitest/reporters';

/**
 * Vitest config with BDD contracts enabled. Native `it`/`test` cases are
 * rejected by default; pass `{ policy: "warn" }` during a staged migration.
 */
declare function bddConfig(overrides?: UserConfig, contract?: BddContractOptions): vite.UserConfig;

export { bddConfig };
