/**
 * Test levels with enforced constraints.
 *
 * Each level has a timeout and rules about what's allowed.
 * Break the rules → runtime error. No ambiguity.
 *
 * Usage:
 *   import { unit, component, integration } from "bdd-vitest/levels";
 *
 *   unit("adds numbers", {
 *     given: ["two numbers", () => ({ a: 2, b: 3 })],
 *     when:  ["adding",      (ctx) => ctx.a + ctx.b],
 *     then:  ["returns sum", (r) => expect(r).toBe(5)],
 *   });
 */
/** Phase: [description, function] tuple — description is enforced */
type Phase<TFn> = [desc: string, fn: TFn];
interface LevelConfig {
    /** Max time per scenario (ms) */
    timeout: number;
    /** Warn if test takes longer than this (ms). Default: 50% of timeout. */
    warnAt?: number;
    /** Level name for error messages */
    name: string;
    /** Suggested next level (for warning message) */
    nextLevel?: string;
}
interface LevelScenario<TContext, TResult> {
    given?: Phase<() => TContext | Promise<TContext>> | string;
    when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
    then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
    cleanup?: (context: TContext) => void | Promise<void>;
    /** Suppress slow-test warning. Use when you know the test is intentionally slow for its level. */
    slow?: boolean;
}
interface TableRow {
    name: string;
    [key: string]: unknown;
}
interface LevelRunner {
    <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>): void;
    skip: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
    only: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
    group: (name: string, fn: () => void) => void;
    outline: <TRow extends TableRow, TContext, TResult>(name: string, table: TRow[], phases: {
        given: (row: TRow) => TContext | Promise<TContext>;
        when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
        then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
        cleanup?: (context: TContext) => void | Promise<void>;
        slow?: boolean;
    }) => void;
}
/** Pure logic. No I/O, no mocks, no services. <100ms. */
declare const unit: LevelRunner;
/** Service in isolation. Mocked dependencies. <5s. */
declare const component: LevelRunner;
/** Multiple services together. Real dependencies. <30s. */
declare const integration: LevelRunner;
/** Full system, browser, network. <120s. */
declare const e2e: LevelRunner;

export { type LevelConfig, type LevelRunner, type LevelScenario, type Phase, type TableRow, component, e2e, integration, unit };
