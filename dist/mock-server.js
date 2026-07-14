// src/mock-server.ts
import { createServer } from "http";
function normalizeResponse(raw) {
  if (typeof raw === "number") {
    return { status: raw, body: "", headers: {} };
  }
  if (raw && typeof raw === "object" && ("status" in raw || "body" in raw || "headers" in raw)) {
    const r = raw;
    const body = r.body !== void 0 ? JSON.stringify(r.body) : "";
    return {
      status: r.status ?? 200,
      body,
      headers: { "content-type": "application/json", ...r.headers }
    };
  }
  return { status: 200, body: JSON.stringify(raw), headers: { "content-type": "application/json" } };
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
  });
}
function mockServer(routes) {
  return () => new Promise((resolve, reject) => {
    const calls = {};
    const requests = {};
    const server = createServer(async (req, res) => {
      const method = req.method ?? "GET";
      const pathname = (req.url ?? "/").split("?")[0];
      const routeKey = `${method} ${pathname}`;
      const route = routes[routeKey] ?? routes[`* ${pathname}`] ?? routes[pathname];
      if (route === void 0) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({
          error: `No mock for ${routeKey}`,
          available: Object.keys(routes)
        }));
        return;
      }
      calls[routeKey] = (calls[routeKey] ?? 0) + 1;
      const body = await readBody(req);
      if (!requests[routeKey]) requests[routeKey] = [];
      try {
        requests[routeKey].push(JSON.parse(body));
      } catch {
        requests[routeKey].push(body);
      }
      const callIndex = calls[routeKey] - 1;
      const raw = Array.isArray(route) ? route[Math.min(callIndex, route.length - 1)] : route;
      const { status, body: resBody, headers } = normalizeResponse(raw);
      res.writeHead(status, headers);
      res.end(resBody);
    });
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        url: `http://localhost:${addr.port}`,
        calls,
        requests,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}
export {
  mockServer
};
