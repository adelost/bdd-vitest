import {
  component,
  e2e,
  integration,
  unit
} from "./chunk-R4KYBEVR.js";
import "./chunk-3RG5ZIWI.js";

// src/index.ts
import { describe, it } from "vitest";
import { expect as expect2 } from "vitest";
function createScenarioRunner(itFn) {
  return function runScenario(name, phases) {
    itFn(name, async () => {
      let phase = "given";
      try {
        const context = phases.given ? typeof phases.given === "string" ? void 0 : await phases.given[1]() : void 0;
        phase = "when";
        const result = phases.when ? await phases.when[1](context) : context;
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
var _scenario = createScenarioRunner(it);
var _scenarioOnly = createScenarioRunner(it.only);
var _scenarioSkip = createScenarioRunner(it.skip);
function scenario(name, phases) {
  _scenario(name, phases);
}
scenario.only = function(name, phases) {
  _scenarioOnly(name, phases);
};
scenario.skip = function(name, phases) {
  _scenarioSkip(name, phases);
};
function feature(name, fn) {
  describe(name, fn);
}
function rule(name, fn) {
  describe(name, fn);
}
function scenarioWithCleanup(name, phases) {
  it(name, async () => {
    const context = phases.given ? typeof phases.given === "string" ? void 0 : await phases.given[1]() : void 0;
    try {
      const result = phases.when ? await phases.when[1](context) : context;
      await phases.then[1](result, context);
    } finally {
      if (phases.cleanup) {
        await phases.cleanup(context);
      }
    }
  });
}
function scenarioOutline(name, table, phases) {
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
export {
  component,
  e2e,
  expect2 as expect,
  feature,
  integration,
  rule,
  scenario,
  scenarioOutline,
  scenarioWithCleanup,
  unit
};
