import {
  component,
  e2e,
  integration,
  unit
} from "./chunk-JC26A3SC.js";

// src/index.ts
import { describe } from "vitest";
import { expect } from "vitest";
function validateGroup(name, fn, label) {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${label} requires a non-empty name`);
  }
  if (typeof fn !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
}
function feature(name, fn) {
  validateGroup(name, fn, "feature");
  describe(name, fn);
}
function rule(name, fn) {
  validateGroup(name, fn, "rule");
  describe(name, fn);
}
export {
  component,
  e2e,
  expect,
  feature,
  integration,
  rule,
  unit
};
