import { expect } from "vitest";
import { unit, component, integration, e2e } from "../src/levels";

// --- unit ---

unit.group("pure logic", () => {
  unit("adds numbers", {
    given: ["two numbers", () => ({ a: 2, b: 3 })],
    when:  ["adding", (ctx) => ctx.a + ctx.b],
    then:  ["returns sum", (r) => expect(r).toBe(5)],
  });

  unit("string concat", {
    given: ["two strings", () => ({ a: "hello", b: " world" })],
    when:  ["concatenating", (ctx) => ctx.a + ctx.b],
    then:  ["returns joined string", (r) => expect(r).toBe("hello world")],
  });

  unit("given as description only", {
    given: "a known constant",
    when:  ["reading Math.PI", () => Math.PI],
    then:  ["is ~3.14", (r) => expect(r).toBeCloseTo(3.14, 1)],
  });

  unit("then only", {
    then: ["true is true", () => expect(true).toBe(true)],
  });
});

// --- component (with mock) ---

component.group("API client", () => {
  component("parses JSON response", {
    given: ["a JSON string", () => '{"name":"Alice","age":30}'],
    when:  ["parsing", (json) => JSON.parse(json)],
    then:  ["has correct fields", (obj) => {
      expect(obj.name).toBe("Alice");
      expect(obj.age).toBe(30);
    }],
  });

  component("handles async operation", {
    given: ["a delayed value", () => new Promise<number>(r => setTimeout(() => r(42), 50))],
    when:  ["doubling", async (n) => n * 2],
    then:  ["returns 84", (r) => expect(r).toBe(84)],
  });
});

// --- integration ---

integration.group("multi-step", () => {
  integration("pipeline with cleanup", {
    given: ["a resource", () => ({ data: [1, 2, 3], cleaned: false })],
    when:  ["processing", (ctx) => ctx.data.reduce((a, b) => a + b, 0)],
    then:  ["sum is correct", (r) => expect(r).toBe(6)],
    cleanup: (ctx) => { ctx.cleaned = true; },
  });
});

// --- unit timeout budget ---

unit("allows short work within the unit timeout", {
  when: ["running a short asynchronous operation", async () => {
    const start = performance.now();
    await new Promise(r => setTimeout(r, 10));
    return performance.now() - start;
  }],
  then: ["the operation remains below the 100ms unit budget", (elapsed) => {
    expect(elapsed).toBeLessThan(100);
  }],
});

// --- e2e ---

e2e.group("full system", () => {
  e2e("works with long timeout", {
    given: ["a value", () => "e2e"],
    when:  ["checking length", (v) => v.length],
    then:  ["has length 3", (r) => expect(r).toBe(3)],
  });
});

// --- outline with cleanup ---

unit.outline("outline with cleanup", [
  { name: "first", x: 1 },
  { name: "second", x: 2 },
], {
  given: ["the row value", (row) => row.x as number],
  when:  ["adding ten", (ctx) => ctx + 10],
  then:  ["the expected value is returned", (result, _ctx, row) => expect(result).toBe((row.x as number) + 10)],
  cleanup: () => { /* verify no throw */ },
});

// --- skip ---

unit.skip("this should be skipped", {
  then: ["never runs", () => { throw new Error("should not run"); }],
});
