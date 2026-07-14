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
/**
 * Reporter enforcing that every collected test carries metadata written by a
 * BDD level runner. Supports the modern Vitest reporter API and Vitest 2's
 * legacy `onCollected` hook.
 */
declare function bddContractReporter(options?: BddContractOptions): Reporter;

export { type BddContractOptions, type BddContractPolicy, type BddTestMetadata, bddContractReporter };
