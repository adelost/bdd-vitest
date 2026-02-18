import {
  component,
  e2e,
  integration,
  unit
} from "./chunk-42KWBLKL.js";
import "./chunk-3RG5ZIWI.js";

// src/index.ts
import { describe } from "vitest";
import { expect } from "vitest";
function feature(name, fn) {
  if (!name.trim()) throw new Error("feature requires a non-empty name");
  describe(name, fn);
}
function rule(name, fn) {
  if (!name.trim()) throw new Error("rule requires a non-empty name");
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
