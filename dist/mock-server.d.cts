/**
 * Declarative mock HTTP server for tests.
 *
 * Usage:
 *   import { mockServer } from "bdd-vitest/mock-server";
 *
 *   component("retries on 503", {
 *     given: ["an unreliable API", mockServer({
 *       "POST /v1/completions": [
 *         { status: 503, body: { error: "overloaded" } },
 *         { status: 200, body: { result: "ok" } },
 *       ],
 *     })],
 *     when: ["requesting with retry", (server) =>
 *       fetchWithRetry(`${server.url}/v1/completions`)],
 *     then: ["succeeds", (res) => expect(res.ok).toBe(true)],
 *     cleanup: (server) => server.close(),
 *   });
 */
/** Response: object with body, just a status code, or plain JSON (implicit 200) */
type MockResponse = {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
} | number | unknown;
/** Route value: single response or array (sequential — first call gets first response, etc.) */
type MockRoutes = Record<string, MockResponse | MockResponse[]>;
interface MockServerInstance {
    /** Base URL, e.g. http://localhost:34521 */
    url: string;
    /** Per-route call counts */
    calls: Record<string, number>;
    /** Recorded request bodies per route */
    requests: Record<string, unknown[]>;
    /** Shut down the server */
    close: () => Promise<void>;
}
/**
 * Creates a mock server tuple-compatible function.
 * Returns a function that starts the server and returns a MockServerInstance.
 *
 * Use directly in given:
 *   given: ["an API", mockServer({ "GET /users": [{ name: "Alice" }] })]
 */
declare function mockServer(routes: MockRoutes): () => Promise<MockServerInstance>;

export { type MockResponse, type MockRoutes, type MockServerInstance, mockServer };
