"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/mock-fetch.ts
var mock_fetch_exports = {};
__export(mock_fetch_exports, {
  mockFetch: () => mockFetch
});
module.exports = __toCommonJS(mock_fetch_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  mockFetch
});
