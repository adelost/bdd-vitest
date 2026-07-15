import { bddConfig } from "./src/preset.js";

export default bddConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      "test/fixtures/reporter-override/**",
      "test/fixtures/service-signal/**",
    ],
  },
});
