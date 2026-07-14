/**
 * bdd-vitest — Enforced Given/When/Then for Vitest
 *
 * Usage:
 *   import { feature, unit, component } from "bdd-vitest";
 *
 *   feature("Queue", () => {
 *     unit("rejects when full", {
 *       given: ["a full queue", () => createQueue({ maxSize: 50, filled: 50 })],
 *       when:  ["enqueueing", (queue) => queue.enqueue(mockRequest()).catch(e => e)],
 *       then:  ["error says queue full", (error) => expect(error.message).toContain("Queue full")],
 *     });
 *   });
 */

import { describe } from "vitest";

// Re-export vitest essentials for convenience
export { expect } from "vitest";

// Re-export levels as primary API
export { unit, component, integration, e2e } from "./levels.js";

// Re-export types used by levels
export type {
  DocumentedOutline,
  LegacyOutline,
  LevelRunner,
  LevelScenario,
  OutlineRunner,
  Phase,
  TableRow,
} from "./levels.js";

function validateGroup(name: unknown, fn: unknown, label: string): asserts fn is () => void {
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(`${label} requires a non-empty name`);
  }
  if (typeof fn !== "function") {
    throw new Error(`${label} callback must be a function`);
  }
}

// --- Core: feature ---

/**
 * Groups related scenarios. Alias for describe with intent.
 */
export function feature(name: string, fn: () => void): void {
  validateGroup(name, fn, "feature");
  describe(name, fn);
}

// --- Core: rule ---

/**
 * Sub-groups within a feature for related business rules.
 */
export function rule(name: string, fn: () => void): void {
  validateGroup(name, fn, "rule");
  describe(name, fn);
}
