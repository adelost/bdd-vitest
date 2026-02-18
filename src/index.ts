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
export type { Phase } from "./levels.js";

// --- Core: feature ---

/**
 * Groups related scenarios. Alias for describe with intent.
 */
export function feature(name: string, fn: () => void): void {
  if (!name.trim()) throw new Error("feature requires a non-empty name");
  describe(name, fn);
}

// --- Core: rule ---

/**
 * Sub-groups within a feature for related business rules.
 */
export function rule(name: string, fn: () => void): void {
  if (!name.trim()) throw new Error("rule requires a non-empty name");
  describe(name, fn);
}
