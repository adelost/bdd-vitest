import { Reporter } from 'vitest/reporters';

type BddContractPolicy = "off" | "warn" | "error";
interface BddContractOptions {
    /** Enforce that tests are registered through exactly one BDD level runner. */
    levelPolicy?: BddContractPolicy;
    /** Enforce scenario and phase documentation. */
    documentationPolicy?: BddContractPolicy;
    /** @deprecated Use levelPolicy. */
    policy?: BddContractPolicy;
    /** @deprecated Use documentationPolicy (false maps to off). */
    requirePhaseDescriptions?: boolean;
}
interface ResolvedBddContractOptions {
    levelPolicy: BddContractPolicy;
    documentationPolicy: BddContractPolicy;
    requirePhaseDescriptions: boolean;
}
/** Internal Vitest provided-context key shared by the preset and setup gate. */
declare const BDD_CONTRACT_CONTEXT_KEY = "bdd-vitest.contract.v1";
interface BddTestMetadata {
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
interface ContractViolation {
    kind: "level" | "documentation";
    message: string;
}
declare function metadataViolations(name: string, meta: Record<string, unknown> | undefined, requirePhaseDescriptions: boolean): ContractViolation[];
declare function resolveBddContractOptions(options?: BddContractOptions): ResolvedBddContractOptions;
/** Enforce violations from the worker-side setup hook. */
declare function enforceRuntimeViolations(violations: ContractViolation[], options: ResolvedBddContractOptions): void;
/**
 * Reporter enforcing that every collected test carries metadata written by a
 * BDD level runner. Supports the modern Vitest reporter API and Vitest 2's
 * legacy `onCollected` hook.
 */
declare function bddContractReporter(options?: BddContractOptions): Reporter;

export { BDD_CONTRACT_CONTEXT_KEY, type BddContractOptions, type BddContractPolicy, type BddTestMetadata, type ContractViolation, type ResolvedBddContractOptions, bddContractReporter, enforceRuntimeViolations, metadataViolations, resolveBddContractOptions };
