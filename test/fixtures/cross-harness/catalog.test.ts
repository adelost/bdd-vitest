import { expect } from "vitest";
import { feature, unit } from "../../../src/index.js";

feature("checkout", () => {
  unit("applies discount over 500kr", {
    given: ["a cart totaling 600kr", () => 600],
    when: ["applying a ten percent discount", (total) => total * 0.9],
    then: ["the total is 540kr", (discounted) => expect(discounted).toBe(540)],
  });
});
