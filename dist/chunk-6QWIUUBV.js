// src/levels.ts
import { describe, it } from "vitest";
function requireDescription(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} requires a non-empty description`);
  }
}
function validatePhase(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} must be a [description, callback] tuple`);
  }
  requireDescription(value[0], label);
  if (typeof value[1] !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
}
function validateScenario(phases) {
  if (!phases || typeof phases !== "object") {
    throw new Error("scenario phases must be an object");
  }
  if (typeof phases.given === "string") {
    requireDescription(phases.given, "given");
  } else if (phases.given !== void 0) {
    validatePhase(phases.given, "given");
  }
  if (phases.when !== void 0) {
    validatePhase(phases.when, "when");
  }
  validatePhase(phases.then, "then");
  if (phases.cleanup !== void 0 && typeof phases.cleanup !== "function") {
    throw new Error("cleanup callback must be a function");
  }
  if (phases.slow !== void 0 && typeof phases.slow !== "boolean") {
    throw new Error("slow must be a boolean");
  }
}
function scenarioMetadata(level, name, phases) {
  return {
    version: 1,
    level: level.name,
    scenario: name,
    phases: {
      given: typeof phases.given === "string" ? phases.given : phases.given?.[0],
      when: phases.when?.[0],
      then: phases.then[0]
    },
    documented: true
  };
}
function testOptions(level, metadata) {
  return {
    timeout: level.wallTimeout ?? level.timeout,
    meta: { bdd: metadata }
  };
}
var COMPONENT_TIMEOUT_MS = 5e3;
var LEVELS = {
  unit: {
    timeout: 100,
    wallTimeout: COMPONENT_TIMEOUT_MS,
    budgetClock: "thread-work",
    warnAt: 50,
    name: "unit",
    nextLevel: "component"
  },
  component: { timeout: COMPONENT_TIMEOUT_MS, warnAt: 2e3, name: "component", nextLevel: "integration" },
  integration: { timeout: 3e4, warnAt: 15e3, name: "integration", nextLevel: "e2e" },
  e2e: { timeout: 12e4, warnAt: 6e4, name: "e2e" }
};
function startScenarioTiming() {
  return {
    wallStartedAt: performance.now(),
    threadCpuStartedAt: process.threadCpuUsage(),
    explicitAsyncWaitMs: 0
  };
}
function threadCpuMs(startedAt) {
  const elapsed = process.threadCpuUsage(startedAt);
  return (elapsed.user + elapsed.system) / 1e3;
}
function isPromiseLike(value) {
  return (typeof value === "object" && value !== null || typeof value === "function") && typeof value.then === "function";
}
async function runPhase(timing, callback) {
  const wallStartedAt = performance.now();
  const threadCpuStartedAt = process.threadCpuUsage();
  const result = callback();
  if (!isPromiseLike(result)) return result;
  try {
    return await result;
  } finally {
    const wallMs = performance.now() - wallStartedAt;
    const cpuMs = threadCpuMs(threadCpuStartedAt);
    timing.explicitAsyncWaitMs += Math.max(0, wallMs - cpuMs);
  }
}
function finishScenarioTiming(level, name, timing, slow) {
  const wallMs = performance.now() - timing.wallStartedAt;
  const elapsed = level.budgetClock === "thread-work" ? threadCpuMs(timing.threadCpuStartedAt) + timing.explicitAsyncWaitMs : wallMs;
  if (level.budgetClock === "thread-work" && elapsed > level.timeout) {
    throw new Error(
      `[${level.name}/budget] "${name}" used ${Math.round(elapsed)}ms of measured work (${level.timeout}ms work budget)`
    );
  }
  const warnAt = level.warnAt ?? level.timeout * 0.5;
  if (!slow && elapsed > warnAt) {
    const next = level.nextLevel ? ` Is this a ${level.nextLevel} test?` : "";
    const clock = level.budgetClock === "thread-work" ? " measured work" : " wall time";
    console.warn(
      `\u26A0\uFE0F  [${level.name}] "${name}" used ${Math.round(elapsed)}ms of${clock} (warn: ${warnAt}ms, limit: ${level.timeout}ms).${next}`
    );
  }
}
function phaseDescription(phases, phase) {
  if (phase === "given") {
    return typeof phases.given === "string" ? phases.given : phases.given?.[0] ?? "setup";
  }
  if (phase === "when") return phases.when?.[0] ?? "action";
  if (phase === "then") return phases.then[0];
  return "cleanup completes";
}
function tagScenarioError(error, level, phase, scenario, description) {
  const prefix = `[${level.name}/${phase}] ${scenario} > ${description}`;
  if (error instanceof Error) {
    if (!error.message.startsWith("[")) error.message = `${prefix}: ${error.message}`;
    return error;
  }
  return new Error(`${prefix}: ${String(error)}`, { cause: error });
}
function aggregateScenarioFailures(level, scenario, primary, cleanup) {
  const message = [
    `[${level.name}/cleanup] ${scenario}: scenario and cleanup both failed`,
    `- ${primary.message}`,
    `- ${cleanup.message}`
  ].join("\n");
  return new AggregateError([primary, cleanup], message);
}
async function executeScenario(name, phases, level) {
  validateScenario(phases);
  const timing = startScenarioTiming();
  let phase = "given";
  let context = void 0;
  let primaryFailure;
  try {
    const given = phases.given;
    if (given && typeof given !== "string") {
      context = await runPhase(timing, () => given[1]());
    }
    phase = "when";
    const result = phases.when ? await runPhase(timing, () => phases.when[1](context)) : context;
    phase = "then";
    await runPhase(timing, () => phases.then[1](result, context));
  } catch (error) {
    primaryFailure = tagScenarioError(
      error,
      level,
      phase,
      name,
      phaseDescription(phases, phase)
    );
  }
  if (phases.cleanup) {
    try {
      await runPhase(timing, () => phases.cleanup(context));
    } catch (error) {
      const cleanupFailure = tagScenarioError(
        error,
        level,
        "cleanup",
        name,
        phaseDescription(phases, "cleanup")
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
function createLevelRunner(level) {
  function run(name, phases) {
    requireDescription(name, level.name);
    validateScenario(phases);
    it(name, testOptions(level, scenarioMetadata(level, name, phases)), () => executeScenario(name, phases, level));
  }
  run.skip = function(name, phases) {
    requireDescription(name, level.name);
    validateScenario(phases);
    it.skip(name, testOptions(level, scenarioMetadata(level, name, phases)), () => {
    });
  };
  run.only = function(name, phases) {
    requireDescription(name, level.name);
    validateScenario(phases);
    it.only(name, testOptions(level, scenarioMetadata(level, name, phases)), () => executeScenario(name, phases, level));
  };
  return run;
}
function createLevelGroup(level) {
  return function group(name, fn) {
    requireDescription(name, `${level.name}.group`);
    if (typeof fn !== "function") throw new Error(`${level.name}.group callback must be a function`);
    describe(`[${level.name}] ${name}`, fn);
  };
}
function createLevelOutline(level) {
  return function(name, table, phases) {
    requireDescription(name, `${level.name}.outline`);
    if (!Array.isArray(table)) throw new Error(`${level.name}.outline table must be an array`);
    if (table.length === 0) throw new Error(`${level.name}.outline requires at least one row`);
    if (!phases || typeof phases !== "object") {
      throw new Error(`${level.name}.outline phases must be an object`);
    }
    const providedPhases = [phases.given, phases.when, phases.then].filter((phase) => phase !== void 0);
    const tupleFlags = providedPhases.map(Array.isArray);
    if (tupleFlags.some(Boolean) && !tupleFlags.every(Boolean)) {
      throw new Error(`${level.name}.outline must describe all phases or use the legacy form for all phases`);
    }
    const documented = tupleFlags.every(Boolean);
    const documentedPhases = phases;
    const legacyPhases = phases;
    const given = documented ? documentedPhases.given?.[1] : legacyPhases.given;
    const when = documented ? documentedPhases.when?.[1] : legacyPhases.when;
    const then = documented ? documentedPhases.then[1] : legacyPhases.then;
    const phaseDescriptions = documented ? {
      given: documentedPhases.given?.[0],
      when: documentedPhases.when?.[0],
      then: documentedPhases.then[0]
    } : {
      given: phases.given === void 0 ? void 0 : "",
      when: phases.when === void 0 ? void 0 : "",
      then: ""
    };
    if (documented) {
      if (documentedPhases.given !== void 0) validatePhase(documentedPhases.given, "given");
      if (documentedPhases.when !== void 0) validatePhase(documentedPhases.when, "when");
      validatePhase(documentedPhases.then, "then");
    } else {
      if (given !== void 0 && typeof given !== "function") {
        throw new Error("given callback must be a function");
      }
      if (when !== void 0 && typeof when !== "function") {
        throw new Error("when callback must be a function");
      }
      if (typeof then !== "function") throw new Error("then callback must be a function");
    }
    if (phases.cleanup !== void 0 && typeof phases.cleanup !== "function") {
      throw new Error("cleanup callback must be a function");
    }
    if (phases.slow !== void 0 && typeof phases.slow !== "boolean") {
      throw new Error("slow must be a boolean");
    }
    const rowNames = /* @__PURE__ */ new Set();
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
        const metadata = {
          version: 1,
          level: level.name,
          scenario: scenarioName,
          phases: phaseDescriptions,
          documented,
          outline: { name, row: row.name }
        };
        it(row.name, testOptions(level, metadata), async () => {
          const timing = startScenarioTiming();
          let phase = "given";
          let context = void 0;
          let primaryFailure;
          try {
            if (given) context = await runPhase(timing, () => given(row));
            phase = "when";
            const result = when ? await runPhase(timing, () => when(context, row)) : context;
            phase = "then";
            await runPhase(timing, () => then(result, context, row));
          } catch (error) {
            const fallbackDescriptions = {
              given: "setup",
              when: "action",
              then: "expectations"
            };
            const description = documented ? phaseDescriptions[phase] ?? fallbackDescriptions[phase] : fallbackDescriptions[phase];
            primaryFailure = tagScenarioError(error, level, phase, scenarioName, description);
          }
          if (phases.cleanup) {
            try {
              await runPhase(timing, () => phases.cleanup(context));
            } catch (error) {
              const cleanupFailure = tagScenarioError(
                error,
                level,
                "cleanup",
                scenarioName,
                "cleanup completes"
              );
              if (primaryFailure) {
                throw aggregateScenarioFailures(
                  level,
                  scenarioName,
                  primaryFailure,
                  cleanupFailure
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
