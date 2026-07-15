import { Reporter } from 'vitest/reporters';
import { BddTestMetadata } from './contract.js';

declare const BDD_RUN_SCHEMA_VERSION: "bdd.run.v1";
type BddRunStatus = "passed" | "failed" | "skipped" | "pending";
interface BddRunScenario {
    name: string;
    phases: BddTestMetadata["phases"];
    documented: boolean;
    outline?: BddTestMetadata["outline"];
}
interface BddRunTest {
    id: string;
    name: string;
    fullName: string;
    file: string;
    line: number | null;
    level: BddTestMetadata["level"] | null;
    documentation: "scenario" | "docstring" | "missing";
    scenarios: BddRunScenario[];
    status: BddRunStatus;
    durationMs: number;
    retryCount: number;
    flaky: boolean;
}
interface BddRunReport {
    schemaVersion: typeof BDD_RUN_SCHEMA_VERSION;
    run: {
        framework: "vitest";
        frameworkVersion: string | null;
        project: string | null;
        repository: string | null;
        commitSha: string | null;
        branch: string | null;
        startedAt: string;
        finishedAt: string;
        durationMs: number;
        status: "passed" | "failed" | "interrupted";
    };
    summary: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        pending: number;
    };
    tests: BddRunTest[];
}
interface BddRunReporterOptions {
    outputFile: string;
    root?: string;
    project?: string;
    repository?: string;
    commitSha?: string;
    branch?: string;
    frameworkVersion?: string;
}
/**
 * Emit the portable `bdd.run.v1` catalog consumed by Suggestions and other CI
 * tooling. The report deliberately excludes console output and stack traces.
 */
declare function bddRunReporter(options: BddRunReporterOptions): Reporter;

export { BDD_RUN_SCHEMA_VERSION, type BddRunReport, type BddRunReporterOptions, type BddRunScenario, type BddRunStatus, type BddRunTest, bddRunReporter };
