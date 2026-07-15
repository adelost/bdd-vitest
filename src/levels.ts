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

import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import type { BddTestMetadata } from "./contract.js";

/** Phase: [description, function] tuple — description is enforced */
export type Phase<TFn> = readonly [desc: string, fn: TFn];

function requireDescription(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} requires a non-empty description`);
  }
}

function validatePhase(value: unknown, label: string): asserts value is Phase<(...args: never[]) => unknown> {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a [description, callback] tuple`);
  }
  requireDescription(value[0], label);
  if (typeof value[1] !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
}

function validateScenario<TContext, TResult>(
  phases: LevelScenario<TContext, TResult>,
): void {
  if (!phases || typeof phases !== "object") {
    throw new Error("scenario phases must be an object");
  }
  if (typeof phases.given === "string") {
    requireDescription(phases.given, "given");
  } else if (phases.given !== undefined) {
    validatePhase(phases.given, "given");
  }
  if (phases.when !== undefined) {
    validatePhase(phases.when, "when");
  }
  validatePhase(phases.then, "then");
  if (phases.cleanup !== undefined && typeof phases.cleanup !== "function") {
    throw new Error("cleanup callback must be a function");
  }
  if (phases.slow !== undefined && typeof phases.slow !== "boolean") {
    throw new Error("slow must be a boolean");
  }
}

// --- Level config ---

export interface LevelConfig {
  /** Max time or measured work per scenario (ms) */
  timeout: number;
  /** Outer wall-clock watchdog. Defaults to timeout. */
  wallTimeout?: number;
  /** `thread-work` counts thread CPU plus waits from Promise-returning phases. Defaults to wall time. */
  budgetClock?: "wall" | "thread-work";
  /** Warn if test takes longer than this (ms). Default: 50% of timeout. */
  warnAt?: number;
  /** Level name for error messages */
  name: BddTestMetadata["level"];
  /** Suggested next level (for warning message) */
  nextLevel?: string;
}

function scenarioMetadata<TContext, TResult>(
  level: LevelConfig,
  name: string,
  phases: LevelScenario<TContext, TResult>,
): BddTestMetadata {
  return {
    version: 1,
    level: level.name,
    scenario: name,
    phases: {
      given: typeof phases.given === "string" ? phases.given : phases.given?.[0],
      when: phases.when?.[0],
      then: phases.then[0],
    },
    documented: true,
  };
}

function testOptions(level: LevelConfig, metadata: BddTestMetadata): { timeout: number } {
  // `meta` is supported by Vitest's collector but is not exposed on TestOptions
  // in every supported Vitest type version.
  return {
    timeout: level.wallTimeout ?? level.timeout,
    meta: { bdd: metadata },
  } as { timeout: number };
}

const COMPONENT_TIMEOUT_MS = 5_000;

const LEVELS = {
  unit: {
    timeout: 100,
    wallTimeout: COMPONENT_TIMEOUT_MS,
    budgetClock: "thread-work",
    warnAt: 50,
    name: "unit",
    nextLevel: "component",
  },
  component:   { timeout: COMPONENT_TIMEOUT_MS, warnAt: 2_000, name: "component", nextLevel: "integration" },
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

type RuntimePhase = "given" | "when" | "then" | "cleanup";

export type UnitWorkClock = "native" | "schedstat" | "process-cpu-degraded";

interface CpuClock {
  kind: UnitWorkClock;
  nowMicros: () => number;
}

function schedstatCpuMicros(): number {
  const cpuNanoseconds = readFileSync("/proc/thread-self/schedstat", "utf8")
    .trim()
    .split(/\s+/, 1)[0];
  if (!cpuNanoseconds) throw new Error("Linux thread schedstat has no CPU-time field");
  return Number(BigInt(cpuNanoseconds) / 1_000n);
}

function createCpuClock(): CpuClock {
  const nativeThreadCpuUsage = Reflect.get(process, "threadCpuUsage") as
    | (() => ReturnType<typeof process.cpuUsage>)
    | undefined;
  if (typeof nativeThreadCpuUsage === "function") {
    return {
      kind: "native",
      nowMicros: () => {
        const elapsed = nativeThreadCpuUsage();
        return elapsed.user + elapsed.system;
      },
    };
  }

  if (process.platform === "linux") {
    try {
      schedstatCpuMicros();
      return { kind: "schedstat", nowMicros: schedstatCpuMicros };
    } catch {
      // The degraded clock below stays conservative and announces itself.
    }
  }

  return {
    kind: "process-cpu-degraded",
    nowMicros: () => {
      const elapsed = process.cpuUsage();
      return elapsed.user + elapsed.system;
    },
  };
}

const UNIT_CPU_CLOCK = createCpuClock();

if (UNIT_CPU_CLOCK.kind === "process-cpu-degraded") {
  console.warn(
    "⚠️  [bdd-vitest] unit work clock: process-cpu-degraded; current-thread CPU is unavailable, so other threads can be conservatively overcounted",
  );
}

interface ScenarioTiming {
  wallStartedAt: number;
  threadCpuStartedAt: number;
  explicitAsyncWaitMs: number;
}

function startScenarioTiming(): ScenarioTiming {
  return {
    wallStartedAt: performance.now(),
    threadCpuStartedAt: UNIT_CPU_CLOCK.nowMicros(),
    explicitAsyncWaitMs: 0,
  };
}

function threadCpuMs(startedAt: number): number {
  return Math.max(0, UNIT_CPU_CLOCK.nowMicros() - startedAt) / 1_000;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && typeof (value as { then?: unknown }).then === "function";
}

async function runPhase<T>(timing: ScenarioTiming, callback: () => T | Promise<T>): Promise<T> {
  const wallStartedAt = performance.now();
  const threadCpuStartedAt = UNIT_CPU_CLOCK.nowMicros();
  const result = callback();
  if (!isPromiseLike(result)) return result;

  try {
    return await result;
  } finally {
    // Promise-returning phases opt into non-CPU waits as semantic work. Scheduler
    // gaps around synchronous phases remain outside the unit work budget.
    const wallMs = performance.now() - wallStartedAt;
    const cpuMs = threadCpuMs(threadCpuStartedAt);
    timing.explicitAsyncWaitMs += Math.max(0, wallMs - cpuMs);
  }
}

function finishScenarioTiming(
  level: LevelConfig,
  name: string,
  timing: ScenarioTiming,
  slow: boolean | undefined,
): void {
  const wallMs = performance.now() - timing.wallStartedAt;
  const elapsed = level.budgetClock === "thread-work"
    ? threadCpuMs(timing.threadCpuStartedAt) + timing.explicitAsyncWaitMs
    : wallMs;

  if (level.budgetClock === "thread-work" && elapsed > level.timeout) {
    throw new Error(
      `[${level.name}/budget] "${name}" used ${Math.round(elapsed)}ms of measured work (${level.timeout}ms work budget)`,
    );
  }

  const warnAt = level.warnAt ?? level.timeout * 0.5;
  if (!slow && elapsed > warnAt) {
    const next = level.nextLevel ? ` Is this a ${level.nextLevel} test?` : "";
    const clock = level.budgetClock === "thread-work" ? " measured work" : " wall time";
    console.warn(
      `⚠️  [${level.name}] "${name}" used ${Math.round(elapsed)}ms of${clock} (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`,
    );
  }
}

function phaseDescription<TContext, TResult>(
  phases: LevelScenario<TContext, TResult>,
  phase: RuntimePhase,
): string {
  if (phase === "given") {
    return typeof phases.given === "string" ? phases.given : phases.given?.[0] ?? "setup";
  }
  if (phase === "when") return phases.when?.[0] ?? "action";
  if (phase === "then") return phases.then[0];
  return "cleanup completes";
}

function tagScenarioError(
  error: unknown,
  level: LevelConfig,
  phase: RuntimePhase,
  scenario: string,
  description: string,
): Error {
  const prefix = `[${level.name}/${phase}] ${scenario} > ${description}`;
  if (error instanceof Error) {
    if (!error.message.startsWith("[")) error.message = `${prefix}: ${error.message}`;
    return error;
  }
  return new Error(`${prefix}: ${String(error)}`, { cause: error });
}

function aggregateScenarioFailures(
  level: LevelConfig,
  scenario: string,
  primary: Error,
  cleanup: Error,
): AggregateError {
  const message = [
    `[${level.name}/cleanup] ${scenario}: scenario and cleanup both failed`,
    `- ${primary.message}`,
    `- ${cleanup.message}`,
  ].join("\n");
  return new AggregateError([primary, cleanup], message);
}

async function executeScenario<TContext, TResult>(
  name: string,
  phases: LevelScenario<TContext, TResult>,
  level: LevelConfig,
): Promise<void> {
  validateScenario(phases);
  const timing = startScenarioTiming();
  let phase: RuntimePhase = "given";
  let context: TContext = undefined as TContext;
  let primaryFailure: Error | undefined;

  try {
    const given = phases.given;
    if (given && typeof given !== "string") {
      context = await runPhase(timing, () => given[1]());
    }
    phase = "when";
    const result = phases.when
      ? await runPhase(timing, () => phases.when![1](context))
      : (context as unknown as TResult);
    phase = "then";
    await runPhase(timing, () => phases.then[1](result, context));
  } catch (error) {
    primaryFailure = tagScenarioError(
      error,
      level,
      phase,
      name,
      phaseDescription(phases, phase),
    );
  }

  if (phases.cleanup) {
    try {
      await runPhase(timing, () => phases.cleanup!(context));
    } catch (error) {
      const cleanupFailure = tagScenarioError(
        error,
        level,
        "cleanup",
        name,
        phaseDescription(phases, "cleanup"),
      );
      if (primaryFailure) {
        throw aggregateScenarioFailures(level, name, primaryFailure, cleanupFailure);
      }
      throw cleanupFailure;
    }
  }

  if (primaryFailure) throw primaryFailure;
  finishScenarioTiming(level, name, timing, phases.slow);
}

function createLevelRunner(level: LevelConfig) {
  function run<TContext, TResult>(
    name: string,
    phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    validateScenario(phases);
    it(name, testOptions(level, scenarioMetadata(level, name, phases)), () =>
      executeScenario(name, phases, level));
  }

  // .skip and .only variants
  run.skip = function <TContext, TResult>(
    name: string,
    phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    validateScenario(phases);
    it.skip(name, testOptions(level, scenarioMetadata(level, name, phases)), () => {});
  };

  run.only = function <TContext, TResult>(
    name: string,
    phases: LevelScenario<TContext, TResult>,
  ): void {
    requireDescription(name, level.name);
    validateScenario(phases);
    it.only(name, testOptions(level, scenarioMetadata(level, name, phases)), () =>
      executeScenario(name, phases, level));
  };

  Object.defineProperty(run, "workClock", {
    value: level.budgetClock === "thread-work" ? UNIT_CPU_CLOCK.kind : "wall",
    enumerable: true,
  });

  return run;
}

// --- Group wrappers (describe with level context) ---

function createLevelGroup(level: LevelConfig) {
  return function group(name: string, fn: () => void): void {
    requireDescription(name, `${level.name}.group`);
    if (typeof fn !== "function") throw new Error(`${level.name}.group callback must be a function`);
    describe(`[${level.name}] ${name}`, fn);
  };
}

// --- Level runner with group ---

export interface TableRow {
  name: string;
  [key: string]: unknown;
}

export interface DocumentedOutline<TContext, TResult, TRow extends TableRow> {
  given?: Phase<(row: TRow) => TContext | Promise<TContext>>;
  when?: Phase<(context: TContext, row: TRow) => TResult | Promise<TResult>>;
  then: Phase<(result: TResult, context: TContext, row: TRow) => void | Promise<void>>;
  cleanup?: (context: TContext) => void | Promise<void>;
  slow?: boolean;
}

/** @deprecated Use DocumentedOutline so every phase is exported as documentation. */
export interface LegacyOutline<TContext, TResult, TRow extends TableRow> {
  given?: (row: TRow) => TContext | Promise<TContext>;
  when?: (context: TContext, row: TRow) => TResult | Promise<TResult>;
  then: (result: TResult, context: TContext, row: TRow) => void | Promise<void>;
  cleanup?: (context: TContext) => void | Promise<void>;
  slow?: boolean;
}

export interface OutlineRunner {
  <TRow extends TableRow, TContext, TResult>(
    name: string,
    table: readonly TRow[],
    phases: DocumentedOutline<TContext, TResult, TRow>,
  ): void;
  /** @deprecated Add descriptions to given/when/then tuples. */
  <TRow extends TableRow, TContext, TResult>(
    name: string,
    table: readonly TRow[],
    phases: LegacyOutline<TContext, TResult, TRow>,
  ): void;
}

export interface LevelRunner {
  <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>): void;
  /** Runtime audit of the clock enforcing this level's budget. */
  readonly workClock: UnitWorkClock | "wall";
  skip: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
  only: <TContext, TResult>(name: string, phases: LevelScenario<TContext, TResult>) => void;
  group: (name: string, fn: () => void) => void;
  outline: OutlineRunner;
}

function createLevelOutline(level: LevelConfig) {
  return function <TRow extends TableRow, TContext, TResult>(
    name: string,
    table: readonly TRow[],
    phases: DocumentedOutline<TContext, TResult, TRow> | LegacyOutline<TContext, TResult, TRow>,
  ): void {
    requireDescription(name, `${level.name}.outline`);
    if (!Array.isArray(table)) throw new Error(`${level.name}.outline table must be an array`);
    if (table.length === 0) throw new Error(`${level.name}.outline requires at least one row`);
    if (!phases || typeof phases !== "object") {
      throw new Error(`${level.name}.outline phases must be an object`);
    }
    const providedPhases = [phases.given, phases.when, phases.then]
      .filter((phase) => phase !== undefined);
    const tupleFlags = providedPhases.map(Array.isArray);
    if (tupleFlags.some(Boolean) && !tupleFlags.every(Boolean)) {
      throw new Error(`${level.name}.outline must describe all phases or use the legacy form for all phases`);
    }
    const documented = tupleFlags.every(Boolean);
    const documentedPhases = phases as DocumentedOutline<TContext, TResult, TRow>;
    const legacyPhases = phases as LegacyOutline<TContext, TResult, TRow>;
    const given = documented ? documentedPhases.given?.[1] : legacyPhases.given;
    const when = documented ? documentedPhases.when?.[1] : legacyPhases.when;
    const then = documented ? documentedPhases.then[1] : legacyPhases.then;
    const phaseDescriptions = documented
      ? {
          given: documentedPhases.given?.[0],
          when: documentedPhases.when?.[0],
          then: documentedPhases.then[0],
        }
      : {
          given: phases.given === undefined ? undefined : "",
          when: phases.when === undefined ? undefined : "",
          then: "",
        };
    if (documented) {
      if (documentedPhases.given !== undefined) validatePhase(documentedPhases.given, "given");
      if (documentedPhases.when !== undefined) validatePhase(documentedPhases.when, "when");
      validatePhase(documentedPhases.then, "then");
    } else {
      if (given !== undefined && typeof given !== "function") {
        throw new Error("given callback must be a function");
      }
      if (when !== undefined && typeof when !== "function") {
        throw new Error("when callback must be a function");
      }
      if (typeof then !== "function") throw new Error("then callback must be a function");
    }
    if (phases.cleanup !== undefined && typeof phases.cleanup !== "function") {
      throw new Error("cleanup callback must be a function");
    }
    if (phases.slow !== undefined && typeof phases.slow !== "boolean") {
      throw new Error("slow must be a boolean");
    }
    const rowNames = new Set<string>();
    for (const row of table) {
      if (!row || typeof row !== "object") {
        throw new Error(`${level.name}.outline rows must be objects`);
      }
      requireDescription(row.name, `${level.name}.outline row`);
      if (rowNames.has(row.name)) {
        throw new Error(`${level.name}.outline row names must be unique: "${row.name}"`);
      }
      rowNames.add(row.name);
    }
    describe(`[${level.name}] ${name}`, () => {
      for (const row of table) {
        const scenarioName = `${name} [${row.name}]`;
        const metadata: BddTestMetadata = {
          version: 1,
          level: level.name,
          scenario: scenarioName,
          phases: phaseDescriptions,
          documented,
          outline: { name, row: row.name },
        };
        it(row.name, testOptions(level, metadata), async () => {
          const timing = startScenarioTiming();
          let phase: RuntimePhase = "given";
          let context: TContext = undefined as TContext;
          let primaryFailure: Error | undefined;

          try {
            if (given) context = await runPhase(timing, () => given(row));
            phase = "when";
            const result = when
              ? await runPhase(timing, () => when(context, row))
              : (context as unknown as TResult);
            phase = "then";
            await runPhase(timing, () => then(result, context, row));
          } catch (error) {
            const fallbackDescriptions = {
              given: "setup",
              when: "action",
              then: "expectations",
            } as const;
            const description = documented
              ? phaseDescriptions[phase as "given" | "when" | "then"]
                ?? fallbackDescriptions[phase as "given" | "when" | "then"]
              : fallbackDescriptions[phase as "given" | "when" | "then"];
            primaryFailure = tagScenarioError(error, level, phase, scenarioName, description);
          }

          if (phases.cleanup) {
            try {
              await runPhase(timing, () => phases.cleanup!(context));
            } catch (error) {
              const cleanupFailure = tagScenarioError(
                error,
                level,
                "cleanup",
                scenarioName,
                "cleanup completes",
              );
              if (primaryFailure) {
                throw aggregateScenarioFailures(
                  level,
                  scenarioName,
                  primaryFailure,
                  cleanupFailure,
                );
              }
              throw cleanupFailure;
            }
          }

          if (primaryFailure) throw primaryFailure;
          finishScenarioTiming(level, row.name, timing, phases.slow);
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
