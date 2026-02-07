# bdd-vitest

Enforced Given/When/Then for Vitest. ~200 lines. Zero config.

## Why

Most test frameworks let you write `it("does something", () => {})` with no structure inside. AI agents (and tired humans) skip descriptions, skip assertions, write tests that pass but prove nothing.

bdd-vitest forces structure:

```ts
unit("rejects when queue is full", {
  given: ["a queue at max capacity", () => createQueue({ max: 50, filled: 50 })],
  when:  ["enqueueing another request", (q) => q.enqueue(mockReq()).catch(e => e)],
  then:  ["returns queue-full error", (err) => expect(err.message).toContain("full")],
});
```

Read just the descriptions — you understand the system without opening production code.

## Install

```bash
npm install -D bdd-vitest
```

## That's it

```ts
import { unit, component, feature, expect } from "bdd-vitest";

feature("Checkout", () => {
  unit("applies discount over 500kr", {
    given: ["a cart with total 600kr",  () => createCart(600)],
    when:  ["checking out",             (cart) => checkout(cart)],
    then:  ["10% discount applied",     (res) => expect(res.discount).toBe(60)],
  });
});
```

You must pick a level: `unit`, `component`, `integration`, or `e2e`. No generic `scenario` — choosing a level is the point.

TypeScript infers the full chain: `given` return → `when` input → `then` input. Autocomplete works.

## Enforced descriptions

Every phase is a `[description, fn]` tuple. You can't skip the description — TypeScript won't let you.

```ts
// ✅ Compiles
given: ["a logged-in user", () => login()]

// ❌ Type error — no description
given: [() => login()]
```

## Flexible phases

`then` is required. Everything else is optional:

```ts
unit("full",       { given, when, then });  // setup → action → assert
unit("no action",  { given, then });         // setup → assert
unit("no setup",   { when, then });          // action → assert
unit("assertion",  { then });                // just assert

// No setup code? given can be just a description:
component("health check", {
  given: "a running server",
  when:  ["requesting /health", () => app.request("/health")],
  then:  ["returns 200",       (res) => expect(res.status).toBe(200)],
});
```

## Context flows through

`when` receives `given`'s return. `then` receives both:

```ts
unit("FIFO order", {
  given: ["a queue with tracker", () => ({ order: [] as number[] })],
  when:  ["processing tasks",    async (ctx) => {
    await enqueueAll([1, 2, 3], (n) => { ctx.order.push(n); return n; });
    return ctx.order;
  }],
  then:  ["order preserved", (result, ctx) => {
    expect(result).toEqual([1, 2, 3]);
  }],
});
```

## Table-driven

```ts
unit.outline("adds numbers correctly", [
  { name: "positives",  a: 2,  b: 3, expected: 5 },
  { name: "negatives",  a: -1, b: 1, expected: 0 },
  { name: "zeros",      a: 0,  b: 0, expected: 0 },
], {
  given: (row) => ({ a: row.a as number, b: row.b as number }),
  when:  (ctx) => ctx.a + ctx.b,
  then:  (result, _ctx, row) => expect(result).toBe(row.expected),
});
```

## Cleanup

```ts
component("reads temp file", {
  given:   ["a temp file", () => createTempFile("data")],
  when:    ["reading it",  (f) => readFile(f)],
  then:    ["has content", (c) => expect(c).toBe("data")],
  cleanup: (file) => deleteFile(file),
});
```

## Error messages show which phase failed

```
AssertionError: [given] Database connection failed
AssertionError: [when] Request timeout
AssertionError: [then] expected 42 to be 43
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

`feature` and `rule` are `describe` with intent. Nothing magic.

## Mock server (built-in)

No dependencies. Real HTTP server on a random port:

```ts
import { mockServer } from "bdd-vitest/mock-server";

component("retries on 503", {
  given: ["an unreliable API", mockServer({
    "POST /v1/completions": [
      { status: 503, body: { error: "overloaded" } },
      { status: 200, body: { choices: [{ message: { content: "hi" } }] } },
    ],
  })],
  when:  ["sending with retry", (server) =>
    fetchWithRetry(`${server.url}/v1/completions`)],
  then:  ["succeeds on second attempt", (res) =>
    expect(res.status).toBe(200)],
  cleanup: (server) => server.close(),
});
```

Response shortcuts:

```ts
"GET /users":    { name: "Alice" }           // → 200 + JSON (implicit)
"DELETE /users/1": 204                        // → status only
"POST /submit":  [{ status: 503 }, { status: 200, body: { ok: true } }]  // → sequential
```

Tracks calls and request bodies: `server.calls["POST /submit"]`, `server.requests["POST /submit"]`.

## Mock fetch (built-in)

Same idea, but patches global `fetch` instead of starting a server:

```ts
import { mockFetch } from "bdd-vitest/mock-fetch";

component("handles 404", {
  given: ["github returns 404", mockFetch({
    "GET https://api.github.com/users/x": 404,
  })],
  when:  ["fetching user", () => fetch("https://api.github.com/users/x")],
  then:  ["returns 404", (res) => expect(res.status).toBe(404)],
  cleanup: (mock) => mock.restore(),
});
```

## Test levels (enforced)

Stop agents (and humans) from writing slow unit tests or mocking everything in integration tests:

```ts
import { unit, component, integration } from "bdd-vitest/levels";

// Pure logic. No I/O. Timeout: 100ms.
unit("calculates discount", {
  given: ["cart over 500kr", () => createCart(600)],
  when:  ["applying rules",  (cart) => applyDiscount(cart)],
  then:  ["10% off",         (r) => expect(r.discount).toBe(60)],
});

// Service in isolation. Mocked dependencies. Timeout: 5s.
component("returns users", {
  given: ["a mocked API", mockServer({ "GET /users": [{ name: "Alice" }] })],
  when:  ["fetching users", (server) => getUsers(server.url)],
  then:  ["returns list",   (users) => expect(users).toHaveLength(1)],
  cleanup: (server) => server.close(),
});

// Multiple services together. Timeout: 30s.
integration("checkout with payment", {
  given: ["app + payment service", async () => ({
    app: await startService(appConfig),
    pay: await startService(paymentConfig),
  })],
  when:  ["completing order", async (ctx) => checkout(ctx.app.url, ctx.pay.url)],
  then:  ["payment processed", (r) => expect(r.paid).toBe(true)],
  cleanup: async (ctx) => { await ctx.app.stop(); await ctx.pay.stop(); },
});
```

**Enforced:** exceed the timeout → test fails. Exceed the warning threshold → you get a nudge:

```
⚠️  [unit] "parse config" took 80ms (warn: 50ms, limit: 100ms). Is this a component test?
⚠️  [component] "fetch users" took 3s (warn: 2s, limit: 5s). Is this an integration test?
```

| Level | Warning | Timeout | Use for |
|-------|---------|---------|---------|
| `unit` | 50ms | 100ms | Pure logic, no I/O |
| `component` | 2s | 5s | Service in isolation, mocked deps |
| `integration` | 15s | 30s | Multiple services, real deps |
| `e2e` | 60s | 120s | Full system, browser, network |

Know it's slow? Suppress the warning:

```ts
unit("parses huge config", {
  slow: true,  // no warning, timeout still enforced
  given: ...
});
```

Group tests by level:

```ts
unit.group("discount rules", () => {
  unit("10% over 500kr", { ... });
  unit("no discount under 500kr", { ... });
});
```

Four levels. No escape hatch. If it doesn't fit, it doesn't belong in CI.

## API

| Export | What |
|--------|------|
| `unit` / `component` / `integration` / `e2e` | Test with enforced level + timeout |
| `.skip` / `.only` / `.group` | Modifiers on any level |
| `feature(name, fn)` / `rule(name, fn)` | Grouping (describe aliases) |
| `mockServer(routes)` | Declarative HTTP mock server |
| `mockFetch(routes)` | Patches global fetch |
| `expect` | Re-exported from vitest |

## License

MIT
