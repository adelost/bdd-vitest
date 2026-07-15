import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { integration, unit } from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = resolve(projectRoot, "test/fixtures");
const vitestBin = resolve(projectRoot, "node_modules/vitest/vitest.mjs");

const fixtureSource = (
  name: string,
  body: string,
  { asyncPhase = false, outline = false } = {},
) => `
import { expect } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { unit } from "../../../src/levels.js";

const cpuMicros = () => Number(
  BigInt(readFileSync("/proc/thread-self/schedstat", "utf8").split(" ", 1)[0]) / 1_000n,
);
const cpuMs = (start) => {
  return (cpuMicros() - start) / 1_000;
};

${outline ? `unit.outline(${JSON.stringify(name)}, [{ name: "contended row" }], {` : `unit(${JSON.stringify(name)}, {`}
  when: ["running the bounded work", ${asyncPhase ? "async " : ""}() => {
    ${body}
  }],
  then: ["the fixture completes", (value) => expect(value).toBe(true)],
});
`;

type VitestResult = Pick<SpawnSyncReturns<string>, "status" | "stderr" | "stdout">;

const childOutput = (result: VitestResult) =>
  `${result.stdout}\n${result.stderr}`;

const vitestArgs = (file: string) => [
    vitestBin,
    "run",
    file,
    "--maxWorkers=1",
    "--reporter=dot",
  ];

const childOptions = () => ({
  cwd: projectRoot,
  env: {
    ...process.env,
    NO_COLOR: "1",
    VITEST_MIN_FORKS: "1",
    VITEST_MIN_THREADS: "1",
  },
  timeout: 20_000,
});

const runVitest = (file: string): SpawnSyncReturns<string> =>
  spawnSync(process.execPath, vitestArgs(file), {
    ...childOptions(),
    encoding: "utf8",
  });

const runContendedVitest = (file: string, cpu: string): Promise<VitestResult> =>
  new Promise((resolveResult) => {
    const child = spawn("taskset", ["-c", cpu, process.execPath, ...vitestArgs(file)],
      childOptions());
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { stderr += `\n${error.message}`; });
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });

integration("unit work budgets ignore scheduler preemption without masking slow work", {
  given: ["four contended units, two real poisons, and a degraded-clock audit", async () => {
    const temp = await mkdtemp(resolve(fixtureRoot, "scheduler-budget-"));
    const readyFiles = Array.from({ length: 4 }, (_, index) =>
      resolve(temp, `contention-${index}.ready`));
    const contentionFiles = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
      const file = resolve(temp, `contention-${index}.test.ts`);
      await writeFile(file, fixtureSource(`bounded CPU unit ${index}`, `
        writeFileSync(${JSON.stringify(readyFiles[index])}, "");
        const readyFiles = ${JSON.stringify(readyFiles)};
        const waitArray = new Int32Array(new SharedArrayBuffer(4));
        while (!readyFiles.every(existsSync)) Atomics.wait(waitArray, 0, 0, 10);
        const started = cpuMicros();
        while (cpuMs(started) < 70) Math.sqrt(144);
        return true;
      `, { outline: index === 3 }));
      return file;
    }));
    const cpuPoison = resolve(temp, "cpu-poison.test.ts");
    await writeFile(cpuPoison, fixtureSource("real CPU poison", `
      const started = cpuMicros();
      while (cpuMs(started) < 130) Math.sqrt(144);
      return true;
    `));
    const asyncPoison = resolve(temp, "async-poison.test.ts");
    await writeFile(asyncPoison, fixtureSource("real async poison", `
      await new Promise((done) => setTimeout(done, 180));
      return true;
    `, { asyncPhase: true }));
    const degradedAudit = resolve(temp, "degraded-audit.test.ts");
    await writeFile(degradedAudit, `
import { expect } from "vitest";

const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
const threadCpuDescriptor = Object.getOwnPropertyDescriptor(process, "threadCpuUsage");
const originalWarn = console.warn;
const warnings = [];
let levels;
try {
  Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  Object.defineProperty(process, "threadCpuUsage", { value: undefined, configurable: true });
  console.warn = (...args) => warnings.push(args.join(" "));
  levels = await import("../../../src/levels.js?degraded-clock");
} finally {
  console.warn = originalWarn;
  if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor);
  if (threadCpuDescriptor) Object.defineProperty(process, "threadCpuUsage", threadCpuDescriptor);
  else Reflect.deleteProperty(process, "threadCpuUsage");
}

levels.unit("makes a degraded clock explicit", {
  then: ["the audit and warning expose conservative process CPU", () => {
    expect(levels.unit.workClock).toBe("process-cpu-degraded");
    expect(warnings.join("\\n")).toContain("process-cpu-degraded");
    expect(warnings.join("\\n")).toContain("other threads can be conservatively overcounted");
  }],
});
`);
    return { temp, contentionFiles, cpuPoison, asyncPoison, degradedAudit };
  }],
  when: ["running the fixtures through real Vitest workers", async (fixtures) => {
    if (process.platform !== "linux") return { fixtures, unsupported: process.platform };
    const status = await readFile("/proc/self/status", "utf8");
    const allowed = status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1];
    if (!allowed) throw new Error("cannot read the Linux CPU affinity list");
    const cpu = allowed.split(",", 1)[0].split("-", 1)[0];
    return {
      fixtures,
      contention: await Promise.all(fixtures.contentionFiles.map((file) =>
        runContendedVitest(file, cpu))),
      cpuPoison: runVitest(fixtures.cpuPoison),
      asyncPoison: runVitest(fixtures.asyncPoison),
      degradedAudit: runVitest(fixtures.degradedAudit),
    };
  }],
  then: ["contention passes while both kinds of real work fail", (result) => {
    if ("unsupported" in result) return;
    expect(result.contention).toHaveLength(4);
    for (const worker of result.contention) {
      const output = childOutput(worker);
      expect(worker.status, output).toBe(0);
      expect(output).toContain("1 passed");
    }
    for (const poison of [result.cpuPoison, result.asyncPoison]) {
      const output = childOutput(poison);
      expect(poison.status, output).toBe(1);
      expect(output).toContain("100ms work budget");
    }
    const auditOutput = childOutput(result.degradedAudit);
    expect(result.degradedAudit.status, auditOutput).toBe(0);
    expect(auditOutput).toContain("1 passed");
  }],
  cleanup: async (result) => {
    await rm(result.temp, { recursive: true, force: true });
  },
});

unit("exposes the active unit work clock for runtime audit", {
  then: ["the clock mode is explicit", () => {
    expect(["native", "schedstat", "process-cpu-degraded"]).toContain(unit.workClock);
  }],
});
