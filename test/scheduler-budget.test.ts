import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { integration } from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = resolve(projectRoot, "test/fixtures");
const vitestBin = resolve(projectRoot, "node_modules/vitest/vitest.mjs");

const fixtureSource = (
  name: string,
  body: string,
  { asyncPhase = false, outline = false } = {},
) => `
import { expect } from "vitest";
import { unit } from "../../../src/levels.js";

const cpuMs = (start) => {
  const elapsed = process.threadCpuUsage(start);
  return (elapsed.user + elapsed.system) / 1_000;
};

${outline ? `unit.outline(${JSON.stringify(name)}, [{ name: "contended row" }], {` : `unit(${JSON.stringify(name)}, {`}
  when: ["running the bounded work", ${asyncPhase ? "async " : ""}() => {
    ${body}
  }],
  then: ["the fixture completes", (value) => expect(value).toBe(true)],
});
`;

const childOutput = (result: SpawnSyncReturns<string>) =>
  `${result.stdout}\n${result.stderr}`;

const runVitest = (files: string[], cpu?: string) => {
  const args = [
    process.execPath,
    vitestBin,
    "run",
    ...files,
    "--minWorkers=4",
    "--maxWorkers=4",
    "--reporter=dot",
  ];
  return spawnSync(cpu === undefined ? process.execPath : "taskset",
    cpu === undefined ? args.slice(1) : ["-c", cpu, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 20_000,
    });
};

integration("unit work budgets ignore scheduler preemption without masking slow work", {
  given: ["four contended units and two real over-budget poisons", async () => {
    const temp = await mkdtemp(resolve(fixtureRoot, "scheduler-budget-"));
    const contentionFiles = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const file = resolve(temp, `contention-${index}.test.ts`);
      await writeFile(file, fixtureSource(`bounded CPU unit ${index}`, `
        const started = process.threadCpuUsage();
        while (cpuMs(started) < 70) Math.sqrt(144);
        return true;
      `, { outline: index === 3 }));
      return file;
    }));
    const cpuPoison = resolve(temp, "cpu-poison.test.ts");
    await writeFile(cpuPoison, fixtureSource("real CPU poison", `
      const started = process.threadCpuUsage();
      while (cpuMs(started) < 130) Math.sqrt(144);
      return true;
    `));
    const asyncPoison = resolve(temp, "async-poison.test.ts");
    await writeFile(asyncPoison, fixtureSource("real async poison", `
      await new Promise((done) => setTimeout(done, 180));
      return true;
    `, { asyncPhase: true }));
    return { temp, contentionFiles, cpuPoison, asyncPoison };
  }],
  when: ["running the fixtures through real Vitest workers", async (fixtures) => {
    if (process.platform !== "linux") return { fixtures, unsupported: process.platform };
    const status = await readFile("/proc/self/status", "utf8");
    const allowed = status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
    if (!allowed) throw new Error("cannot read the Linux CPU affinity list");
    const cpu = allowed.split(",", 1)[0].split("-", 1)[0];
    return {
      fixtures,
      contention: runVitest(fixtures.contentionFiles, cpu),
      cpuPoison: runVitest([fixtures.cpuPoison]),
      asyncPoison: runVitest([fixtures.asyncPoison]),
    };
  }],
  then: ["contention passes while both kinds of real work fail", (result) => {
    if ("unsupported" in result) return;
    const contentionOutput = childOutput(result.contention);
    expect(result.contention.status, contentionOutput).toBe(0);
    expect(contentionOutput).toContain("4 passed");
    for (const poison of [result.cpuPoison, result.asyncPoison]) {
      const output = childOutput(poison);
      expect(poison.status, output).toBe(1);
      expect(output).toContain("100ms work budget");
    }
  }],
  cleanup: async (result) => {
    await rm(result.temp, { recursive: true, force: true });
  },
});
