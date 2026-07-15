import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect } from "vitest";
import { component, feature, integration } from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const vitestBin = resolve(projectRoot, "node_modules/vitest/vitest.mjs");

function runVitest(args: string[]) {
  return spawnSync(process.execPath, [vitestBin, "run", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

feature("runtime contract gates", () => {
  component("cleanup never hides the primary scenario failure", {
    when: ["running a scenario whose behavior and cleanup both fail", () => {
      const result = spawnSync(
        process.execPath,
        [vitestBin, "run", "test/fixtures/cleanup-aggregate.test.ts"],
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, BDD_VITEST_CLEANUP_FAILURE: "1", NO_COLOR: "1" },
        },
      );
      return { result, output: `${result.stdout}\n${result.stderr}` };
    }],
    then: ["both failures and phase labels remain visible", ({ result, output }) => {
      expect(result.status).toBe(1);
      expect(output).toContain("primary broke");
      expect(output).toContain("cleanup broke");
      expect(output).toContain("[unit/then] retains behavior and cleanup failures");
      expect(output).toContain("[unit/cleanup] retains behavior and cleanup failures");
    }],
  });

  component("CLI reporter overrides cannot disable the BDD contract", {
    when: ["running a native test with only the dot reporter", () => {
      const result = runVitest([
        "--root",
        "test/fixtures/reporter-override",
        "--reporter=dot",
      ]);
      return { result, output: `${result.stdout}\n${result.stderr}` };
    }],
    then: ["the worker-side setup gate fails the run", ({ result, output }) => {
      expect(result.status).not.toBe(0);
      expect(output).toContain("bdd-vitest contract violations");
      expect(output).toContain("missing bdd metadata");
    }],
  });

  integration("termination signals kill tracked service processes", {
    when: ["signalling a Vitest worker with a running service", () => {
      const result = runVitest([
        "--root",
        "test/fixtures/service-signal",
        "--reporter=dot",
      ]);
      const output = `${result.stdout}\n${result.stderr}`;
      const match = output.match(/BDD_SERVICE_PID=(\d+)/);
      return { result, output, servicePid: match ? Number(match[1]) : null };
    }],
    then: ["the worker fails closed without leaving the service alive", ({
      result,
      output,
      servicePid,
    }) => {
      expect(result.status).not.toBe(0);
      expect(servicePid, output).not.toBeNull();
      if (servicePid === null) return;
      try {
        expect(isProcessAlive(servicePid), output).toBe(false);
      } finally {
        if (isProcessAlive(servicePid)) process.kill(servicePid, "SIGKILL");
      }
    }],
  });
});
