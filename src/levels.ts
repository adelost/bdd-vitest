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

import { describe, it } from "vitest";

/** Phase: [description, function] tuple — description is enforced */
export type Phase<TFn> = [desc: string, fn: TFn];

function requireDescription(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} requires a non-empty description`);
}

function validatePhaseDescriptions<TContext, TResult>(
  phases: LevelScenario<TContext, TResult>,
): void {
  if (Array.isArray(phases.given) && !phases.given[0].trim()) {
    throw new Error("given requires a non-empty description");
  }
  if (phases.when && !phases.when[0].trim()) {
    throw new Error("when requires a non-empty description");
  }
  if (!phases.then[0].trim()) {
    throw new Error("then requires a non-empty description");
  }
}

// --- Level config ---

export interface LevelConfig {
  /** Max time per scenario (ms) */
  timeout: number;
  /** Warn if test takes longer than this (ms). Default: 50% of timeout. */
  warnAt?: number;
  /** Level name for error messages */
  name: string;
  /** Suggested next level (for warning message) */
  nextLevel?: string;
}

const LEVELS = {
  unit:        { timeout: 100,     warnAt: 50,     name: "unit",        nextLevel: "component" },
  component:   { timeout: 5_000,   warnAt: 2_000,  name: "component",   nextLevel: "integration" },
  integration: { timeout: 30_000,  warnAt: 15_000, name: "integration", nextLevel: "e2e" },
  e2e:         { timeout: 120_000, warnAt: 60_000, name: "e2e" },
} as const;

// --- Level scenario ---

export interface LevelScenario<TContext, TResult> {
  given?: Phase<() => TContext | Promise<TContext>> | string;
  when?: Phase<(context: TContext) => TResult | Promise<TResult>>;
  then: Phase<(result: TResult, context: TContext) => void | Promise<void>>;
  cleanup?: (context: TContext) => void | Promise<void>;
  /** Suppress slow-test warning. Use when you know the test is intentionally slow for its level. */
  slow?: boolean;
}

async function executeScenario<TContext, TResult>(
  name: string,
  phases: LevelScenario<TContext, TResult>,
  level: LevelConfig,
): Promise<void> {
  validatePhaseDescriptions(phases);
  const start = performance.now();
  let phase = "given";
  let context: TContext = undefined as TContext;

  try {
    if (phases.given && typeof phases.given !== "string") {
      context = await phases.given[1]();
    }
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
  } finally {
    if (phases.cleanup) {
      await phases.cleanup(context);
    }
  }

  const elapsed = performance.now() - start;
  const warnAt = level.warnAt ?? level.timeout * 0.5;
  if (!phases.slow && elapsed > warnAt) {
    const next = level.nextLevel ? ` Is this a ${level.nextLevel} test?` : "";
    console.warn(
      `⚠️  [${level.name}] "${name}" took ${Math.round(elapsed)}ms (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`,
    );
  }
}

function createLevelRunner(level: LevelConfig) {
  function run<TContext, TResult>(
    name: string,
    phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    validatePhaseDescriptions(phases);
    it(name, { timeout: level.timeout }, () => executeScenario(name, phases, level));
  }

  // .skip and .only variants
  run.skip = function <TContext, TResult>(
    name: string,
    _phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    it.skip(name, () => {});
  };

  run.only = function <TContext, TResult>(
    name: string,
    phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    validatePhaseDescriptions(phases);
    it.only(name, { timeout: level.timeout }, () => executeScenario(name, phases, level));
  };

  return run;
}

// --- Group wrappers (describe with level context) ---

function createLevelGroup(level: LevelConfig) {
  return function group(name: string, fn: () => void): void {
    requireDescription(name, `${level.name}.group`);
    describe(`[${level.name}] ${name}`, fn);
  };
}

// --- Level runner with group ---

export interface TableRow {
  name: string;
  [key: string]: unknown;
}

export interface LevelRunner {
  <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>): void;
  skip: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
  only: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
  group: (name: string, fn: () => void) => void;
  outline: <TRow extends TableRow, TContext, TResult>(
    name: string,
    table: TRow[],
    phases: {
      given: (row: TRow) => TContext | Promise<TContext>;
      when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
      then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
      cleanup?: (context: TContext) => void | Promise<void>;
      slow?: boolean;
    },
  ) => void;
}

function createLevelOutline(level: LevelConfig) {
  return function <TRow extends TableRow, TContext, TResult>(
    name: string,
    table: TRow[],
    phases: {
      given: (row: TRow) => TContext | Promise<TContext>;
      when: (context: TContext, row: TRow) => TResult | Promise<TResult>;
      then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
      cleanup?: (context: TContext) => void | Promise<void>;
      slow?: boolean;
    },
  ): void {
    requireDescription(name, `${level.name}.outline`);
    describe(`[${level.name}] ${name}`, () => {
      for (const row of table) {
        requireDescription(row.name, `${level.name}.outline row`);
        it(row.name, { timeout: level.timeout }, async () => {
          const start = performance.now();
          let phase = "given";
          let context: TContext = undefined as TContext;

          try {
            context = await phases.given(row);
            phase = "when";
            const result = await phases.when(context, row);
            phase = "then";
            await phases.then(result, context, row);
          } catch (error) {
            if (error instanceof Error && !error.message.startsWith("[")) {
              error.message = `[${phase}] ${error.message}`;
            }
            throw error;
          } finally {
            if (phases.cleanup) {
              await phases.cleanup(context);
            }
          }

          const elapsed = performance.now() - start;
          const warnAt = level.warnAt ?? level.timeout * 0.5;
          if (!phases.slow && elapsed > warnAt) {
            const next = level.nextLevel ? ` Is this a ${level.nextLevel} test?` : "";
            console.warn(
              `⚠️  [${level.name}] "${row.name}" took ${Math.round(elapsed)}ms (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`,
            );
          }
        });
      }
    });
  };
}

function buildLevel(config: LevelConfig): LevelRunner {
  const runner = createLevelRunner(config) as LevelRunner;
  runner.group = createLevelGroup(config);
  runner.outline = createLevelOutline(config);
  return runner;
}

// --- Exports ---

/** Pure logic. No I/O, no mocks, no services. <100ms. */
export const unit: LevelRunner = buildLevel(LEVELS.unit);
/** Service in isolation. Mocked dependencies. <5s. */
export const component: LevelRunner = buildLevel(LEVELS.component);
/** Multiple services together. Real dependencies. <30s. */
export const integration: LevelRunner = buildLevel(LEVELS.integration);
/** Full system, browser, network. <120s. */
export const e2e: LevelRunner = buildLevel(LEVELS.e2e);
