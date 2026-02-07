// src/levels.ts
import { describe, it } from "vitest";
var LEVELS = {
  unit: { timeout: 100, warnAt: 50, name: "unit", nextLevel: "component" },
  component: { timeout: 5e3, warnAt: 2e3, name: "component", nextLevel: "integration" },
  integration: { timeout: 3e4, warnAt: 15e3, name: "integration", nextLevel: "e2e" },
  e2e: { timeout: 12e4, warnAt: 6e4, name: "e2e" }
};
function createLevelRunner(level) {
  function run(name, phases) {
    it(name, { timeout: level.timeout }, async () => {
      const start = performance.now();
      let phase = "given";
      let context = void 0;
      try {
        if (phases.given && typeof phases.given !== "string") {
          context = await phases.given[1]();
        }
        phase = "when";
        const result = phases.when ? await phases.when[1](context) : context;
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
          `\u26A0\uFE0F  [${level.name}] "${name}" took ${Math.round(elapsed)}ms (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`
        );
      }
    });
  }
  run.skip = function(name, _phases) {
    it.skip(name, () => {
    });
  };
  run.only = function(name, phases) {
    it.only(name, { timeout: level.timeout }, async () => {
      let phase = "given";
      let context = void 0;
      try {
        if (phases.given && typeof phases.given !== "string") {
          context = await phases.given[1]();
        }
        phase = "when";
        const result = phases.when ? await phases.when[1](context) : context;
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
    });
  };
  return run;
}
function createLevelGroup(level) {
  return function group(name, fn) {
    describe(`[${level.name}] ${name}`, fn);
  };
}
function createLevelOutline(level) {
  return function(name, table, phases) {
    describe(`[${level.name}] ${name}`, () => {
      for (const row of table) {
        it(row.name, { timeout: level.timeout }, async () => {
          const context = await phases.given(row);
          const result = await phases.when(context, row);
          await phases.then(result, context, row);
        });
      }
    });
  };
}
function buildLevel(config) {
  const runner = createLevelRunner(config);
  runner.group = createLevelGroup(config);
  runner.outline = createLevelOutline(config);
  return runner;
}
var unit = buildLevel(LEVELS.unit);
var component = buildLevel(LEVELS.component);
var integration = buildLevel(LEVELS.integration);
var e2e = buildLevel(LEVELS.e2e);

export {
  unit,
  component,
  integration,
  e2e
};
