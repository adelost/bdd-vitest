// src/mock-fetch.ts
function normalizeResponse(raw) {
  if (typeof raw === "number") {
    return new Response(null, { status: raw });
  }
  if (raw && typeof raw === "object" && ("status" in raw || "body" in raw || "headers" in raw)) {
    const r = raw;
    const body = r.body !== void 0 ? JSON.stringify(r.body) : null;
    return new Response(body, {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...r.headers }
    });
  }
  return new Response(JSON.stringify(raw), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
function mockFetch(routes) {
  return () => {
    const original = globalThis.fetch;
    const calls = {};
    globalThis.fetch = (async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const requestMethod = typeof Request !== "undefined" && input instanceof Request ? input.method : void 0;
      const method = (init?.method ?? requestMethod ?? "GET").toUpperCase();
      const routeKey = `${method} ${url}`;
      const route = routes[routeKey] ?? routes[url];
      if (route === void 0) {
        throw new Error(
          `mockFetch: no mock for ${routeKey}
Available: ${Object.keys(routes).join(", ")}`
        );
      }
      calls[routeKey] = (calls[routeKey] ?? 0) + 1;
      const callIndex = calls[routeKey] - 1;
      const raw = Array.isArray(route) ? route[Math.min(callIndex, route.length - 1)] : route;
      return normalizeResponse(raw);
    });
    return {
      calls,
      restore: () => {
        globalThis.fetch = original;
      }
    };
  };
}
export {
  mockFetch
};
