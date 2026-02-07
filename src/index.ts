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

import { describe, it, expect } from "vitest";

// Re-export vitest essentials for convenience
export { expect } from "vitest";

// Re-export levels as primary API
export { unit, component, integration, e2e } from "./levels.js";

// Helper to create scenario variants (skip/only)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createScenarioRunner(itFn: any) {
  return function runScenario<TContext, TResult>(
    name: string,
    phases: Scenario<TContext, TResult>,
  ): void {
    itFn(name, async () => {
      let phase = "given";
      try {
        const context = phases.given
          ? typeof phases.given === "string"
            ? (undefined as TContext)
            : await phases.given[1]()
          : (undefined as TContext);
        phase = "when";
        const result = phases.when
          ? await phases.when[1](context)
          : (context as unknown as TResult);
        phase = "then";
        await phases.then[1](result, context);
      } catch (error) {
        if (error instanceof Error && !error.message.startsWith("[")) {
          error.message = `[${phase}] ${error.message}`;
        }
        throw error;
      }
    });
  };
}

// --- Core: scenario ---

/** Phase: [description, function] tuple — description is enforced */
export type Phase<TFn> = [desc: string, fn: TFn];

export interface Scenario<TContext, TResult> {
  /** Setup — tuple, description-only string, or omitted */
  given?: Phase<() => TContext | Promise<TContext>> | string;
  /** Action — tuple or omitted */
  when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
  /** Assertion — required */
  then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
}

/**
 * Defines a single test scenario with BDD phases.
 *
 * `then` is always required. `given` and `when` are optional:
 *   - given + when + then  — full scenario
 *   - given + then         — verify state after setup
 *   - when + then          — verify action without setup
 *   - then only            — pure assertion
 */
const _scenario = createScenarioRunner(it);
const _scenarioOnly = createScenarioRunner(it.only);
const _scenarioSkip = createScenarioRunner(it.skip);

/**
 * @deprecated Use `unit`, `component`, `integration`, or `e2e` instead.
 * Choosing a level is required — it enforces timeouts and communicates intent.
 */
export function scenario<TContext, TResult>(
  name: string,
  phases: Scenario<TContext, TResult>,
): void {
  _scenario(name, phases);
}

scenario.only = function <TContext, TResult>(
  name: string,
  phases: Scenario<TContext, TResult>,
): void {
  _scenarioOnly(name, phases);
};

scenario.skip = function <TContext, TResult>(
  name: string,
  phases: Scenario<TContext, TResult>,
): void {
  _scenarioSkip(name, phases);
};

// --- Core: feature ---

/**
 * Groups related scenarios. Alias for describe with intent.
 */
export function feature(name: string, fn: () => void): void {
  describe(name, fn);
}

// --- Core: rule ---

/**
 * Sub-groups within a feature for related business rules.
 */
export function rule(name: string, fn: () => void): void {
  describe(name, fn);
}

// --- Helpers: scenarios with setup/teardown ---

export interface ScenarioWithLifecycle<TContext, TResult> {
  given?: Phase<() => TContext | Promise<TContext>> | string;
  when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
  then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
  cleanup?: (context: TContext) => void | Promise<void>;
}

/**
 * Scenario with automatic cleanup after assertion.
 */
export function scenarioWithCleanup<TContext, TResult>(
  name: string,
  phases: ScenarioWithLifecycle<TContext, TResult>,
): void {
  it(name, async () => {
    const context = phases.given
      ? typeof phases.given === "string"
        ? (undefined as TContext)
        : await phases.given[1]()
      : (undefined as TContext);
    try {
      const result = phases.when
        ? await phases.when[1](context)
        : (context as unknown as TResult);
      await phases.then[1](result, context);
    } finally {
      if (phases.cleanup) {
        await phases.cleanup(context);
      }
    }
  });
}

// --- Helpers: table-driven scenarios ---

export interface TableRow {
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
export function scenarioOutline<TRow extends TableRow, TContext, TResult>(
  name: string,
  table: TRow[],
  phases: {
    given: (row: TRow) => TContext | Promise<TContext>;
    when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
    then: (
      result: TResult,
      context: TContext,
      row: TRow,
    ) => void | Promise<void>;
  },
): void {
  describe(name, () => {
    for (const row of table) {
      it(row.name, async () => {
        const context = await phases.given(row);
        const result = await phases.when(context, row);
        await phases.then(result, context, row);
      });
    }
  });
}
