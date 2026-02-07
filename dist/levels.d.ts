import 'vitest';

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
interface TableRow$1 {
    name: string;
    [key: string]: unknown;
}
interface LevelRunner {
    <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>): void;
    skip: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
    only: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
    group: (name: string, fn: () => void) => void;
    outline: <TRow extends TableRow$1, TContext, TResult>(name: string, table: TRow[], phases: {
        given: (row: TRow) => TContext | Promise<TContext>;
        when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
        then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
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

/**
 * bdd-vitest — Enforced Given/When/Then for Vitest
 *
 * Usage:
 *   import { feature, scenario } from "bdd-vitest";
 *
 *   feature("Queue", () => {
 *     scenario("rejects when full", {
 *       given: () => createQueue({ maxSize: 50, filled: 50 }),
 *       when:  (queue) => queue.enqueue(mockRequest()).catch(e => e),
 *       then:  (error) => expect(error.message).toContain("Queue full"),
 *     });
 *   });
 */

/** Phase: [description, function] tuple — description is enforced */
type Phase<TFn> = [desc: string, fn: TFn];
interface Scenario<TContext, TResult> {
    /** Setup — tuple, description-only string, or omitted */
    given?: Phase<() => TContext | Promise<TContext>> | string;
    /** Action — tuple or omitted */
    when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
    /** Assertion — required */
    then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
}
/**
 * @deprecated Use `unit`, `component`, `integration`, or `e2e` instead.
 * Choosing a level is required — it enforces timeouts and communicates intent.
 */
declare function scenario<TContext, TResult>(name: string, phases: Scenario<TContext, TResult>): void;
declare namespace scenario {
    var only: <TContext, TResult>(name: string, phases: Scenario<TContext, TResult>) => void;
    var skip: <TContext, TResult>(name: string, phases: Scenario<TContext, TResult>) => void;
}
/**
 * Groups related scenarios. Alias for describe with intent.
 */
declare function feature(name: string, fn: () => void): void;
/**
 * Sub-groups within a feature for related business rules.
 */
declare function rule(name: string, fn: () => void): void;
interface ScenarioWithLifecycle<TContext, TResult> {
    given?: Phase<() => TContext | Promise<TContext>> | string;
    when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
    then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
    cleanup?: (context: TContext) => void | Promise<void>;
}
/**
 * Scenario with automatic cleanup after assertion.
 */
declare function scenarioWithCleanup<TContext, TResult>(name: string, phases: ScenarioWithLifecycle<TContext, TResult>): void;
interface TableRow {
    name: string;
    [key: string]: unknown;
}
/**
 * Run the same scenario with multiple data rows.
 *
 * Usage:
 *   scenarioOutline("adds numbers", [
 *     { name: "positive", a: 2, b: 3, expected: 5 },
 *     { name: "negative", a: -1, b: 1, expected: 0 },
 *   ], {
 *     given: (row) => ({ a: row.a as number, b: row.b as number }),
 *     when:  (ctx) => ctx.a + ctx.b,
 *     then:  (result, _ctx, row) => expect(result).toBe(row.expected),
 *   });
 */
declare function scenarioOutline<TRow extends TableRow, TContext, TResult>(name: string, table: TRow[], phases: {
    given: (row: TRow) => TContext | Promise<TContext>;
    when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
    then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
}): void;

export { type LevelConfig, type LevelRunner, type LevelScenario, type Phase as P, type Scenario as S, type TableRow as T, type TableRow$1 as TableRow, type ScenarioWithLifecycle as a, scenarioOutline as b, scenarioWithCleanup as c, component, e2e, feature as f, integration, rule as r, scenario as s, unit };
