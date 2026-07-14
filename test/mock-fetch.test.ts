import { feature, expect, component } from "../src/index";
import { mockFetch } from "../src/mock-fetch";

feature("mockFetch", () => {
  component("mocks fetch with implicit 200 + JSON", {
    given: ["a mocked API", mockFetch({
      "GET https://api.example.com/users": { name: "Alice" },
    })],
    when: ["fetching", async () => {
      const res = await fetch("https://api.example.com/users");
      return res.json();
    }],
    then: ["returns mocked data", (body) => {
      expect(body).toEqual({ name: "Alice" });
    }],
    cleanup: (mock) => mock.restore(),
  });

  component("mocks status-only response", {
    given: ["a 404 endpoint", mockFetch({
      "GET https://api.example.com/missing": 404,
    })],
    when: ["fetching", async () => fetch("https://api.example.com/missing")],
    then: ["returns 404", (res) => {
      expect(res.status).toBe(404);
    }],
    cleanup: (mock) => mock.restore(),
  });

  component("sequential responses", {
    given: ["an API that flakes", mockFetch({
      "POST https://api.example.com/submit": [
        { status: 500 },
        { status: 200, body: { ok: true } },
      ],
    })],
    when: ["calling twice", async () => {
      const r1 = await fetch("https://api.example.com/submit", { method: "POST" });
      const r2 = await fetch("https://api.example.com/submit", { method: "POST" });
      return { s1: r1.status, s2: r2.status };
    }],
    then: ["first fails, second succeeds", (res) => {
      expect(res.s1).toBe(500);
      expect(res.s2).toBe(200);
    }],
    cleanup: (mock) => mock.restore(),
  });

  component("tracks call counts", {
    given: ["a mocked endpoint", mockFetch({
      "GET https://api.example.com/ping": { pong: true },
    })],
    when: ["calling three times", async (mock) => {
      await fetch("https://api.example.com/ping");
      await fetch("https://api.example.com/ping");
      await fetch("https://api.example.com/ping");
      return mock;
    }],
    then: ["counted all calls", (mock) => {
      expect(mock.calls["GET https://api.example.com/ping"]).toBe(3);
    }],
    cleanup: (mock) => mock.restore(),
  });

  component("throws on unmocked route", {
    given: ["a limited mock", mockFetch({
      "GET https://api.example.com/ok": 200,
    })],
    when: ["fetching unknown URL", async () => {
      try {
        await fetch("https://api.example.com/nope");
        return null;
      } catch (e: any) {
        return e.message;
      }
    }],
    then: ["error lists available routes", (msg) => {
      expect(msg).toContain("no mock for");
      expect(msg).toContain("GET https://api.example.com/ok");
    }],
    cleanup: (mock) => mock.restore(),
  });

  component("uses the method carried by a Request object", {
    given: ["a POST-only mock", mockFetch({
      "POST https://api.example.com/items": 201,
    })],
    when: ["fetching with a POST Request", () =>
      fetch(new Request("https://api.example.com/items", { method: "POST" }))],
    then: ["the POST route is selected", (res) => {
      expect(res.status).toBe(201);
    }],
    cleanup: (mock) => mock.restore(),
  });
});
