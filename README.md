# bdd-vitest

Enforced Given/When/Then for Vitest. Tests become documentation. ~200 lines. Zero config.

```ts
import { unit, feature, expect } from "bdd-vitest";

feature("Checkout", () => {
  unit("applies discount over 500kr", {
    given: ["a cart with total 600kr",  () => createCart(600)],
    when:  ["checking out",             (cart) => checkout(cart)],
    then:  ["10% discount applied",     (res) => expect(res.discount).toBe(60)],
  });
});
```

Read just the descriptions  - you understand the system without opening production code.

## Why

Most test frameworks let you write `it("does something", () => {})` with no structure inside. AI agents skip descriptions. Tired humans skip assertions. Tests pass but prove nothing.

bdd-vitest makes it impossible:

- **Descriptions are required.** Every phase is a `["description", fn]` tuple. TypeScript rejects missing descriptions at compile time.
- **Levels are required.** No generic `scenario`  - you must pick `unit`, `component`, `integration`, or `e2e`. Each has enforced timeouts.
- **Assertions are required.** `then` is mandatory. No test without a check.

## Install

```bash
npm install -D bdd-vitest
```

## Levels

Every test must declare its level. Wrong level => timeout fails the test. Slow for its level => warning nudges you.

```ts
import { unit, component, integration, e2e } from "bdd-vitest";
```

| Level | Warning | Timeout | Use for |
|-------|---------|---------|---------|
| `unit` | 50ms | 100ms | Pure logic, no I/O |
| `component` | 2s | 5s | Service in isolation, mocked deps |
| `integration` | 15s | 30s | Multiple services, real deps |
| `e2e` | 60s | 120s | Full system, browser, network |

```
⚠️  [unit] "parse config" took 80ms (warn: 50ms, limit: 100ms). Is this a component test?
```

Know it's intentionally slow? `slow: true` suppresses the warning (timeout still enforced).

## Phases

`then` is always required. Everything else is optional:

```ts
unit("full",       { given, when, then });   // setup => action => assert
unit("no action",  { given, then });          // setup => assert
unit("no setup",   { when, then });           // action => assert
unit("assertion",  { then });                 // just assert
```

No setup code? `given` can be just a description:

```ts
component("health check", {
  given: "a running server",
  when:  ["requesting /health", () => app.request("/health")],
  then:  ["returns 200",       (res) => expect(res.status).toBe(200)],
});
```

Context flows through  - `when` receives `given`'s return, `then` receives both:

```ts
unit("FIFO order", {
  given: ["a queue with tracker", () => ({ order: [] as number[] })],
  when:  ["processing tasks",    async (ctx) => {
    await enqueueAll([1, 2, 3], (n) => { ctx.order.push(n); });
    return ctx.order;
  }],
  then: ["order preserved", (result) => expect(result).toEqual([1, 2, 3])],
});
```

Errors show which phase failed:

```
AssertionError: [given] Database connection failed
AssertionError: [when] Request timeout
AssertionError: [then] expected 42 to be 43
```

## Mock server

No dependencies. Real HTTP server on a random port:

```ts
import { mockServer } from "bdd-vitest/mock-server";

component("retries on 503", {
  given: ["an unreliable API", mockServer({
    "POST /v1/completions": [
      { status: 503, body: { error: "overloaded" } },
      { status: 200, body: { result: "ok" } },
    ],
  })],
  when:    ["sending with retry", (server) => fetchWithRetry(`${server.url}/v1/completions`)],
  then:    ["succeeds",           (res) => expect(res.status).toBe(200)],
  cleanup: (server) => server.close(),
});
```

Response shortcuts:

```ts
"GET /users":      { name: "Alice" }                                       // => 200 + JSON
"DELETE /users/1": 204                                                      // => status only
"POST /submit":    [{ status: 503 }, { status: 200, body: { ok: true } }]  // => sequential
```

## Mock fetch

Same idea, patches global `fetch` instead of starting a server:

```ts
import { mockFetch } from "bdd-vitest/mock-fetch";

component("handles 404", {
  given:   ["github returns 404", mockFetch({ "GET https://api.github.com/users/x": 404 })],
  when:    ["fetching user",      () => fetch("https://api.github.com/users/x")],
  then:    ["returns 404",        (res) => expect(res.status).toBe(404)],
  cleanup: (mock) => mock.restore(),
});
```

## Table-driven

```ts
unit.outline("adds numbers", [
  { name: "positives",  a: 2,  b: 3, expected: 5 },
  { name: "negatives",  a: -1, b: 1, expected: 0 },
], {
  given: (row) => ({ a: row.a as number, b: row.b as number }),
  when:  (ctx) => ctx.a + ctx.b,
  then:  (result, _ctx, row) => expect(result).toBe(row.expected),
});
```

## Grouping

```ts
feature("Auth", () => {
  rule("valid credentials", () => {
    unit("grants access", { ... });
  });
  rule("expired tokens", () => {
    component("refreshes automatically", { ... });
  });
});
```

## API

| Export | What |
|--------|------|
| `unit` / `component` / `integration` / `e2e` | Test with enforced level + timeout |
| `.skip` / `.only` / `.group` / `.outline` | Modifiers on any level |
| `feature(name, fn)` / `rule(name, fn)` | Grouping (describe aliases) |
| `mockServer(routes)` | Declarative HTTP mock server |
| `mockFetch(routes)` | Patches global fetch |
| `expect` | Re-exported from vitest |

## License

MIT
