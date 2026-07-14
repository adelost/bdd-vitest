import { describe, expect, it, vi } from "vitest";
import { bddContractReporter } from "../src/contract.js";
import { bddConfig } from "../src/preset.js";

function fakeModule(tests: Array<{ name: string; meta?: Record<string, unknown> }>) {
  return {
    moduleId: "/tmp/example.test.ts",
    children: {
      allTests: function* () {
        for (const test of tests) {
          yield {
            fullName: test.name,
            meta: () => test.meta ?? {},
          };
        }
      },
    },
  };
}

describe("bddConfig()", () => {
  it("keeps defaults when test overrides are supplied", () => {
    const config = bddConfig({ test: { globals: true } });
    expect(config.test).toMatchObject({
      globals: true,
      testTimeout: 30_000,
      hookTimeout: 20_000,
    });
    expect(config.test?.include).toBeUndefined();
  });

  it("keeps the default reporter when no reporter is configured", () => {
    const config = bddConfig();
    expect(config.test?.reporters?.[0]).toBe("default");
    expect(config.test?.reporters).toHaveLength(2);
  });

  it("keeps user reporters and appends the contract reporter", () => {
    const reporter = { onInit: vi.fn() };
    const config = bddConfig({ test: { reporters: [reporter] } });
    expect(config.test?.reporters).toHaveLength(2);
    expect(config.test?.reporters?.[0]).toBe(reporter);
  });
});

describe("bddContractReporter()", () => {
  function expectContractFailure(run: () => void, message: string) {
    const previousExitCode = process.exitCode;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      run();
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining(message));
    } finally {
      process.exitCode = previousExitCode;
      error.mockRestore();
    }
  }

  it("fails the run for a native test without BDD metadata", () => {
    const reporter = bddContractReporter();
    expectContractFailure(
      () => reporter.onTestModuleCollected?.(fakeModule([
        { name: "native test" },
      ]) as never),
      "missing bdd metadata",
    );
  });

  it("accepts a documented BDD test", () => {
    const reporter = bddContractReporter();
    expect(() => reporter.onTestModuleCollected?.(fakeModule([
      {
        name: "unit test",
        meta: {
          bdd: {
            version: 1,
            level: "unit",
            scenario: "unit test",
            phases: { then: "the result is correct" },
            documented: true,
          },
        },
      },
    ]) as never)).not.toThrow();
  });

  it("rejects forged or incomplete BDD metadata", () => {
    const reporter = bddContractReporter();
    expectContractFailure(
      () => reporter.onTestModuleCollected?.(fakeModule([
        {
          name: "forged test",
          meta: { bdd: { documented: true } },
        },
      ]) as never),
      "metadata version",
    );
  });

  it("can migrate level and documentation enforcement independently", () => {
    const previousExitCode = process.exitCode;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const reporter = bddContractReporter({
        levelPolicy: "warn",
        documentationPolicy: "error",
      });
      reporter.onTestModuleCollected?.(fakeModule([
        { name: "native test" },
        {
          name: "undocumented test",
          meta: {
            bdd: {
              version: 1,
              level: "unit",
              scenario: "undocumented test",
              phases: {},
              documented: true,
            },
          },
        },
      ]) as never);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("missing bdd metadata"));
      expect(error).toHaveBeenCalledWith(expect.stringContaining("missing then description"));
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
      error.mockRestore();
      warning.mockRestore();
    }
  });

  it("still enforces documentation when level enforcement is off", () => {
    const reporter = bddContractReporter({
      levelPolicy: "off",
      documentationPolicy: "error",
    });
    expectContractFailure(
      () => reporter.onTestModuleCollected?.(fakeModule([
        { name: "native undocumented test" },
      ]) as never),
      "missing bdd scenario and phase documentation",
    );
  });

  it("rejects invalid policy values at configuration time", () => {
    expect(() => bddContractReporter({ levelPolicy: "invalid" as never }))
      .toThrow("levelPolicy must be one of: off, warn, error");
  });
});
