import { unit } from "../../src/index.js";

const shouldFail = process.env.BDD_VITEST_CLEANUP_FAILURE === "1";

unit("retains behavior and cleanup failures", {
  then: ["the behavior succeeds", () => {
    if (shouldFail) throw new Error("primary broke");
  }],
  cleanup: () => {
    if (shouldFail) throw new Error("cleanup broke");
  },
});
