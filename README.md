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

Read just the descriptions. You understand the system without opening production code.

## Why

Most test frameworks let you write `it("does something", () => {})` with no structure inside. AI agents (and tired humans) skip descriptions, skip assertions, write tests that pass but prove nothing.

bdd-vitest makes it impossible:

- **Descriptions are required.** Every phase is a `["description", fn]` tuple. TypeScript rejects missing descriptions at compile time.
- **Levels are required.** No generic `scenario`. You must pick `unit`, `component`, `integration`, or `e2e`. Each has enforced timeouts.
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

`when` receives `given`'s return. `then` receives both:

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

## Database tests

No special API needed. `given` sets up, `cleanup` tears down:

```ts
integration("finds user by email", {
  given: ["a seeded database", async () => {
    const db = await createTestDb();
    await db.users.insert({ email: "alice@test.com", name: "Alice" });
    return db;
  }],
  when:    ["querying", (db) => db.users.findBy({ email: "alice@test.com" })],
  then:    ["returns Alice", (user) => expect(user.name).toBe("Alice")],
  cleanup: (db) => db.destroy(),
});
```

Works with any database library. Bring your own setup.

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

## Browser tests (Playwright)

Works with `@vitest/browser` + Playwright. The `e2e` level gives you 120s timeout:

```ts
import { e2e, feature, rule, expect } from "bdd-vitest";
import { page } from "@vitest/browser/context";

feature("Ship AI - Bridge Console", () => {
  rule("authentication", () => {
    e2e("Kai logs in with commander clearance", {
      given: ["the login screen", async () => {
        await page.goto("/bridge/login");
      }],
      when: ["submitting commander credentials", async () => {
        await page.getByLabel("Crew ID").fill("kai");
        await page.getByLabel("Access code").fill("clearance-9");
        await page.getByRole("button", { name: "Authenticate" }).click();
      }],
      then: ["the bridge dashboard loads", async () => {
        await expect.element(page.getByText("Welcome, Commander Kai")).toBeVisible();
        expect(page.url()).toContain("/bridge/dashboard");
      }],
    });
  });

  rule("navigation controls", () => {
    e2e("Yara plots a course from the bridge", {
      given: ["Yara is on the navigation panel", async () => {
        await page.goto("/bridge/navigation");
        await expect.element(page.getByText("Navigation")).toBeVisible();
      }],
      when: ["plotting a course to Proxima", async () => {
        await page.getByLabel("Destination").fill("Proxima Centauri");
        await page.getByRole("button", { name: "Plot course" }).click();
      }],
      then: ["the course is confirmed", async () => {
        await expect.element(page.getByText("Course set: Proxima Centauri")).toBeVisible();
        await expect.element(page.getByText("ETA:")).toBeVisible();
      }],
    });
  });
});
```

## Real world example

```ts
import { unit, component, integration, feature, rule, expect } from "bdd-vitest";
import { mockServer } from "bdd-vitest/mock-server";

feature("Ship AI", () => {
  rule("airlock access", () => {
    unit("denies crew without clearance", {
      given: ["a crew member with no override", () => ({ crew: "Kai", clearance: 0 })],
      when:  ["requesting airlock",              (ctx) => shipAI.evaluateRequest(ctx)],
      then:  ["denies the request",              (res) => {
        expect(res.granted).toBe(false);
        expect(res.reason).toContain("insufficient clearance");
      }],
    });

    unit.outline("clearance levels", [
      { name: "cadet: denied",     clearance: 0, expected: false },
      { name: "engineer: denied",  clearance: 1, expected: false },
      { name: "commander: granted", clearance: 9, expected: true },
    ], {
      given: (row) => ({ crew: "Kai", clearance: row.clearance as number }),
      when:  (ctx) => shipAI.evaluateRequest(ctx),
      then:  (res, _ctx, row) => expect(res.granted).toBe(row.expected),
    });
  });

  rule("crew monitoring API", () => {
    component("reports life signs", {
      given: ["a sensor API", mockServer({
        "GET /crew/kai/vitals": { heartRate: 72, o2: 98, status: "nominal" },
      })],
      when:    ["checking vitals", (server) => shipAI.checkCrew("kai", server.url)],
      then:    ["reports nominal",  (report) => expect(report.status).toBe("nominal")],
      cleanup: (server) => server.close(),
    });

    component("handles sensor failure", {
      given: ["a failing sensor API", mockServer({
        "GET /crew/kai/vitals": 503,
      })],
      when:    ["checking vitals", (server) => shipAI.checkCrew("kai", server.url)],
      then:    ["triggers alert",  (report) => expect(report.status).toBe("sensor_failure")],
      cleanup: (server) => server.close(),
    });
  });

  rule("mission log", () => {
    integration("logs all crew requests", {
      given: ["a mission database", async () => {
        const db = await createMissionDb();
        await shipAI.logRequest(db, { crew: "Kai", action: "open_airlock" });
        await shipAI.logRequest(db, { crew: "Yara", action: "check_antenna" });
        return db;
      }],
      when:    ["querying the log",   (db) => db.logs.findAll()],
      then:    ["contains both entries", (logs) => expect(logs).toHaveLength(2)],
      cleanup: (db) => db.destroy(),
    });
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
