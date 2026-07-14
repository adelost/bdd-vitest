import { expect, unit } from "bdd-vitest";

unit("runs from the installed package", {
  given: ["an installed public API", () => 21],
  when: ["using the packaged runner", (value) => value * 2],
  then: ["the packaged result is correct", (result) => expect(result).toBe(42)],
});
