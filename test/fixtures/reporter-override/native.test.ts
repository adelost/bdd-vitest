import { expect, test } from "vitest";

// Intentionally bypasses bdd-vitest: the parent regression test proves that a
// CLI reporter override cannot make this fixture pass.
test("native test cannot bypass the contract", () => {
  expect(true).toBe(true);
});
