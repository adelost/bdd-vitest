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

export type MockFetchResponse =
  | { status?: number; body?: unknown; headers?: Record<string, string> }
  | number
  | unknown;

export type MockFetchRoutes = Record<string, MockFetchResponse | MockFetchResponse[]>;

export interface MockFetchInstance {
  /** Per-route call counts */
  calls: Record<string, number>;
  /** Restore original fetch */
  restore: () => void;
}

function normalizeResponse(raw: MockFetchResponse): Response {
  if (typeof raw === "number") {
    return new Response(null, { status: raw });
  }
  if (raw && typeof raw === "object" && ("status" in raw || "body" in raw || "headers" in raw)) {
    const r = raw as { status?: number; body?: unknown; headers?: Record<string, string> };
    const body = r.body !== undefined ? JSON.stringify(r.body) : null;
    return new Response(body, {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers },
    });
  }
  return new Response(JSON.stringify(raw), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Creates a fetch mock tuple-compatible function.
 * Patches global fetch. Restore via cleanup or manually.
 *
 * Use in given:
 *   given: ["mocked APIs", mockFetch({ "GET https://api.example.com/foo": { bar: 1 } })]
 */
export function mockFetch(routes: MockFetchRoutes): () => MockFetchInstance {
  return () => {
    const original = globalThis.fetch;
    const calls: Record<string, number> = {};

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const requestMethod = typeof Request !== "undefined" && input instanceof Request
        ? input.method
        : undefined;
      const method = (init?.method ?? requestMethod ?? "GET").toUpperCase();
      const routeKey = `${method} ${url}`;

      // Try exact match, then without method, then URL prefix match
      const route = routes[routeKey] ?? routes[url];

      if (route === undefined) {
        throw new Error(
          `mockFetch: no mock for ${routeKey}\nAvailable: ${Object.keys(routes).join(", ")}`,
        );
      }

      calls[routeKey] = (calls[routeKey] ?? 0) + 1;
      const callIndex = calls[routeKey] - 1;

      const raw = Array.isArray(route)
        ? route[Math.min(callIndex, route.length - 1)]
        : route;

      return normalizeResponse(raw);
    }) as typeof fetch;

    return {
      calls,
      restore: () => { globalThis.fetch = original; },
    };
  };
}
