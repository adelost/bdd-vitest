import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mock-ai": "src/mock-ai.ts",
    "mock-server": "src/mock-server.ts",
    "mock-fetch": "src/mock-fetch.ts",
    levels: "src/levels.ts",
    service: "src/service.ts",
    process: "src/process.ts",
    preset: "src/preset.ts",
    contract: "src/contract.ts",
    "contract-setup": "src/contract-setup.ts",
    report: "src/report.ts",
  },
  format: ["esm", "cjs"],
  outExtension({ format }) {
    return { js: format === "esm" ? ".js" : ".cjs" };
  },
  dts: true,
  clean: true,
  external: ["vitest", "vitest/config"],
});
