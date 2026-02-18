// src/levels.ts
import { describe, it } from "vitest";
function requireDescription(value, label) {
  if (!value.trim()) throw new Error(`${label} requires a non-empty description`);
}
function validatePhaseDescriptions(phases) {
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
var LEVELS = {
  unit: { timeout: 100, warnAt: 50, name: "unit", nextLevel: "component" },
  component: { timeout: 5e3, warnAt: 2e3, name: "component", nextLevel: "integration" },
  integration: { timeout: 3e4, warnAt: 15e3, name: "integration", nextLevel: "e2e" },
  e2e: { timeout: 12e4, warnAt: 6e4, name: "e2e" }
};
async function executeScenario(name, phases, level) {
  validatePhaseDescriptions(phases);
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
}
function createLevelRunner(level) {
  function run(name, phases) {
    requireDescription(name, level.name);
    validatePhaseDescriptions(phases);
    it(name, { timeout: level.timeout }, () => executeScenario(name, phases, level));
  }
  run.skip = function(name, _phases) {
    requireDescription(name, level.name);
    it.skip(name, () => {
    });
  };
  run.only = function(name, phases) {
    requireDescription(name, level.name);
    validatePhaseDescriptions(phases);
    it.only(name, { timeout: level.timeout }, () => executeScenario(name, phases, level));
  };
  return run;
}
function createLevelGroup(level) {
  return function group(name, fn) {
    requireDescription(name, `${level.name}.group`);
    describe(`[${level.name}] ${name}`, fn);
  };
}
function createLevelOutline(level) {
  return function(name, table, phases) {
    requireDescription(name, `${level.name}.outline`);
    describe(`[${level.name}] ${name}`, () => {
      for (const row of table) {
        requireDescription(row.name, `${level.name}.outline row`);
        it(row.name, { timeout: level.timeout }, async () => {
          const start = performance.now();
          let phase = "given";
          let context = void 0;
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
              `\u26A0\uFE0F  [${level.name}] "${row.name}" took ${Math.round(elapsed)}ms (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`
            );
          }
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
