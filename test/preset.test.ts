import { expect, vi } from "vitest";
import { feature, unit } from "../src/index.js";
import { BDD_CONTRACT_CONTEXT_KEY, bddContractReporter } from "../src/contract.js";
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

feature("bddConfig()", () => {
  unit("keeps defaults when test overrides are supplied", {
    when: ["building a config with globals enabled", () =>
      bddConfig({ test: { globals: true } })],
    then: ["defaults and the override are retained", (config) => {
      expect(config.test).toMatchObject({
        globals: true,
        testTimeout: 30_000,
        hookTimeout: 20_000,
      });
      expect(config.test?.include).toBeUndefined();
    }],
  });

  unit("keeps the default reporter when no reporter is configured", {
    when: ["building the default config", () => bddConfig()],
    then: ["the default and contract reporters are installed", (config) => {
      expect(config.test?.reporters?.[0]).toBe("default");
      expect(config.test?.reporters).toHaveLength(2);
    }],
  });

  unit("keeps user reporters and appends the contract reporter", {
    given: ["a custom reporter", () => ({ onInit: vi.fn() })],
    when: ["building a config with that reporter", (reporter) => ({
      reporter,
      config: bddConfig({ test: { reporters: [reporter] } }),
    })],
    then: ["both reporters remain in order", ({ reporter, config }) => {
      expect(config.test?.reporters).toHaveLength(2);
      expect(config.test?.reporters?.[0]).toBe(reporter);
    }],
  });

  unit("installs a setup-file gate with resolved policy context", {
    when: ["building a staged migration config", () => bddConfig({
      test: {
        setupFiles: ["./consumer-setup.ts"],
        provide: { consumerValue: "kept" },
      },
    }, {
      levelPolicy: "warn",
      documentationPolicy: "off",
    })],
    then: ["the gate precedes consumer setup and cannot lose its options", (config) => {
      expect(config.test?.setupFiles).toHaveLength(2);
      expect(config.test?.setupFiles?.[0]).toMatch(/contract-setup\.js$/);
      expect(config.test?.setupFiles?.[1]).toBe("./consumer-setup.ts");
      expect(config.test?.provide).toMatchObject({
        consumerValue: "kept",
        [BDD_CONTRACT_CONTEXT_KEY]: {
          levelPolicy: "warn",
          documentationPolicy: "off",
          requirePhaseDescriptions: false,
        },
      });
    }],
  });
});

feature("bddContractReporter()", () => {
  unit("fails the run for a native test without BDD metadata", {
    given: ["a strict contract reporter", () => bddContractReporter()],
    then: ["native metadata is rejected", (reporter) => {
      expectContractFailure(
        () => reporter.onTestModuleCollected?.(fakeModule([
          { name: "native test" },
        ]) as never),
        "missing bdd metadata",
      );
    }],
  });

  unit("accepts a documented BDD test", {
    given: ["a strict contract reporter", () => bddContractReporter()],
    then: ["valid metadata produces no failure", (reporter) => {
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
    }],
  });

  unit("rejects forged or incomplete BDD metadata", {
    given: ["a strict contract reporter", () => bddContractReporter()],
    then: ["incomplete metadata fails the run", (reporter) => {
      expectContractFailure(
        () => reporter.onTestModuleCollected?.(fakeModule([
          {
            name: "forged test",
            meta: { bdd: { documented: true } },
          },
        ]) as never),
        "metadata version",
      );
    }],
  });

  unit("can migrate level and documentation enforcement independently", {
    given: ["separate warning and error policies", () => ({
      reporter: bddContractReporter({
        levelPolicy: "warn",
        documentationPolicy: "error",
      }),
      previousExitCode: process.exitCode,
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
      warning: vi.spyOn(console, "warn").mockImplementation(() => {}),
    })],
    then: ["each violation follows its own policy", ({
      reporter,
      previousExitCode,
      error,
      warning,
    }) => {
      try {
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
    }],
  });

  unit("still enforces documentation when level enforcement is off", {
    given: ["a documentation-only reporter", () => bddContractReporter({
      levelPolicy: "off",
      documentationPolicy: "error",
    })],
    then: ["native undocumented tests still fail", (reporter) => {
      expectContractFailure(
        () => reporter.onTestModuleCollected?.(fakeModule([
          { name: "native undocumented test" },
        ]) as never),
        "missing bdd scenario and phase documentation",
      );
    }],
  });

  unit("rejects invalid policy values at configuration time", {
    then: ["invalid policy names throw", () => {
      expect(() => bddContractReporter({ levelPolicy: "invalid" as never }))
        .toThrow("levelPolicy must be one of: off, warn, error");
    }],
  });
});
