import { bddConfig } from "../../../src/preset.js";

export default bddConfig({
  test: {
    include: ["signal.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
  },
});
