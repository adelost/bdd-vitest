/**
 * Declarative fetch mock — patches global fetch, restores automatically.
 *
 * Usage:
 *   import { mockFetch } from "bdd-vitest/mock-fetch";
 *
 *   component("handles 404", {
 *     given: ["github returns 404", mockFetch({
 *       "GET https://api.github.com/users/x": 404,
 *       "POST https://api.example.com/data": { id: 1, name: "test" },
 *     })],
 *     when: ["fetching user", () => fetch("https://api.github.com/users/x")],
 *     then: ["returns 404", (res) => expect(res.status).toBe(404)],
 *     cleanup: (mock) => mock.restore(),
 *   });
 */
type MockFetchResponse = {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
} | number | unknown;
type MockFetchRoutes = Record<string, MockFetchResponse | MockFetchResponse[]>;
interface MockFetchInstance {
    /** Per-route call counts */
    calls: Record<string, number>;
    /** Restore original fetch */
    restore: () => void;
}
/**
 * Creates a fetch mock tuple-compatible function.
 * Patches global fetch. Restore via cleanup or manually.
 *
 * Use in given:
 *   given: ["mocked APIs", mockFetch({ "GET https://api.example.com/foo": { bar: 1 } })]
 */
declare function mockFetch(routes: MockFetchRoutes): () => MockFetchInstance;

export { type MockFetchInstance, type MockFetchResponse, type MockFetchRoutes, mockFetch };
