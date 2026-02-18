export { expect } from 'vitest';
export { Phase, component, e2e, integration, unit } from './levels.js';

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

/**
 * Groups related scenarios. Alias for describe with intent.
 */
declare function feature(name: string, fn: () => void): void;
/**
 * Sub-groups within a feature for related business rules.
 */
declare function rule(name: string, fn: () => void): void;

export { feature, rule };
