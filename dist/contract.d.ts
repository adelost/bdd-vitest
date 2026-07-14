import { Reporter } from 'vitest/reporters';

type BddContractPolicy = "off" | "warn" | "error";
interface BddContractOptions {
    /** What to do with tests not registered through a BDD level runner. */
    policy?: BddContractPolicy;
    /** Require explicit Given/When/Then descriptions, including outlines. */
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
