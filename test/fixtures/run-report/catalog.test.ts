import { expect } from "vitest";
import { component, feature, unit } from "../../../src/index.js";

feature("checkout", () => {
  unit("applies discount over 500kr", {
    given: ["a cart totaling 600kr", () => 600],
    when: ["applying a ten percent discount", (total) => total * 0.9],
    then: ["the total is 540kr", (discounted) => expect(discounted).toBe(540)],
  });

  component.skip("documents an unavailable payment service", {
    given: "the payment sandbox is unavailable",
    then: ["the scenario remains visible", () => {}],
  });

  if (process.env.BDD_REPORT_FAILURE === "1") {
    unit("records a failed outcome without leaking diagnostics", {
      then: ["the assertion fails", () => expect("SENSITIVE_FAILURE_DETAIL").toBe("hidden")],
    });
  }
});
