import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { component, integration } from "../src/index.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const fixtureRoot = resolve(projectRoot, "test/fixtures");
const vitestBin = resolve(projectRoot, "node_modules/vitest/vitest.mjs");
const dateStep = resolve(fixtureRoot, "date-step.mjs");

interface FixtureRun { status: number | null; stdout: string; stderr: string }

// Concurrent, not sequential: the hang fixture waits 15s by design, so running
// five children in series pushes this scenario past its own level budget — and
// the honest fix for "my test is slow" is to stop serialising independent work,
// not to widen the budget that caught it.
const runFixture = (file: string, { stepClock = false } = {}): Promise<FixtureRun> =>
  new Promise((resolveRun) => {
    const child = spawn(
      process.execPath,
      [vitestBin, "run", file, "--maxWorkers=1", "--reporter=dot"],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          NO_COLOR: "1",
          VITEST_MIN_FORKS: "1",
          VITEST_MIN_THREADS: "1",
          ...(stepClock ? { NODE_OPTIONS: `--import ${dateStep}` } : {}),
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { stderr += `\n${error.message}`; });
    child.on("close", (status) => resolveRun({ status, stdout, stderr }));
  });

const outputOf = (result: FixtureRun) => `${result.stdout}\n${result.stderr}`;

// Every fixture burns or waits on a MONOTONIC clock. A Date.now-bound loop
// would exit early under the injected step and quietly measure nothing — the
// mistake that cost a day of diagnosis before this change existed.
const preamble = `
import { component } from "../../../src/levels.js";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const cpuMs = () => Number(
  BigInt(readFileSync("/proc/thread-self/schedstat", "utf8").split(" ", 1)[0]) / 1_000n,
) / 1_000;
const burnWall = (ms) => { const end = performance.now() + ms; while (performance.now() < end); };
const burnCpu = (ms) => { const start = cpuMs(); while (cpuMs() - start < ms); };
`;

interface Fixtures {
  temp: string;
  stepVictim: string;
  workPoison: string;
  hang: string;
  frozen: string;
}

integration("component budgets survive a stepping wall clock and still bite on work", {
  given: ["four component fixtures: a step victim, a work poison, a hang, a frozen body", async () => {
    const temp = await mkdtemp(resolve(fixtureRoot, "component-work-clock-"));

    // 1700ms of real work: over the 5000ms wall this replaces once a +4000ms
    // step lands inside it, but far under the 8000ms WORK budget.
    const stepVictim = resolve(temp, "step-victim.test.ts");
    await writeFile(stepVictim, `${preamble}
globalThis.__stepClock = true;
component("does 1700ms of honest work while the wall clock jumps", {
  when: ["burning 1700ms of monotonic time", () => { burnWall(1700); return true; }],
  then: ["it completes", (value) => { if (value !== true) throw new Error("no"); }],
});
`);

    // Genuinely mis-levelled: real CPU past the derived budget.
    const workPoison = resolve(temp, "work-poison.test.ts");
    await writeFile(workPoison, `${preamble}
component("burns more CPU than a component may", {
  when: ["burning 8600ms of thread CPU", () => { burnCpu(8600); return true; }],
  then: ["it completes", (value) => { if (value !== true) throw new Error("no"); }],
});
`);

    // Never settles. Nothing retroactive can catch this; only the watchdog can.
    const hang = resolve(temp, "hang.test.ts");
    await writeFile(hang, `${preamble}
component("never settles", {
  when: ["awaiting a promise that never resolves", () => new Promise(() => {})],
  then: ["unreachable", () => {}],
});
`);

    // SIGSTOP: wall advances, thread CPU does not. The stall form, as distinct
    // from the step form — a work budget must ignore both.
    const frozen = resolve(temp, "frozen.test.ts");
    await writeFile(frozen, `${preamble}
component("is frozen mid-body by SIGSTOP and still passes", {
  when: ["freezing this worker for ~2s around a little real work", () => {
    spawn("sh", ["-c", \`sleep 0.3; kill -STOP \${process.pid}; sleep 2; kill -CONT \${process.pid}\`],
      { detached: true, stdio: "ignore" }).unref();
    burnWall(3000);
    return true;
  }],
  then: ["it completes", (value) => { if (value !== true) throw new Error("no"); }],
});
`);

    return { temp, stepVictim, workPoison, hang, frozen } satisfies Fixtures;
  }],

  when: ["running all five through real Vitest workers at once", async (fixtures: Fixtures) => {
    const [stepped, unstepped, poison, hang, frozen] = await Promise.all([
      runFixture(fixtures.stepVictim, { stepClock: true }),
      runFixture(fixtures.stepVictim),
      runFixture(fixtures.workPoison),
      runFixture(fixtures.hang),
      runFixture(fixtures.frozen),
    ]);
    return { fixtures, stepped, unstepped, poison, hang, frozen };
  }],

  then: ["a moved clock and a frozen thread are survivable; real work and a real hang are not", (run) => {
    // The step must not fail an honest test — the whole point of the change.
    const steppedOut = outputOf(run.stepped);
    expect(run.stepped.status, steppedOut).toBe(0);
    expect(steppedOut).not.toContain("timed out");
    // Control: the same fixture without injection. If this were red the probe
    // would be measuring its own breakage rather than the clock.
    expect(run.unstepped.status, outputOf(run.unstepped)).toBe(0);

    // A frozen thread burns wall time it never spent working.
    expect(run.frozen.status, outputOf(run.frozen)).toBe(0);

    // …but the budget still bites on genuine work, naming the work clock.
    const poisonOut = outputOf(run.poison);
    expect(run.poison.status, poisonOut).toBe(1);
    expect(poisonOut).toContain("8000ms work budget");
    expect(poisonOut).toContain("measured work");

    // …and a scenario that never settles is caught by the watchdog, not by a
    // budget, and says so.
    const hangOut = outputOf(run.hang);
    expect(run.hang.status, hangOut).toBe(1);
    expect(hangOut).toContain("[component/hang]");
    expect(hangOut).toContain("never settled");
  }],

  cleanup: async (fixtures: Fixtures) => {
    await rm(fixtures.temp, { recursive: true, force: true });
  },

  // Intentionally slow, and irreducibly so: proving the hang watchdog fires
  // means waiting out the component hang budget, 15s. The children already run
  // concurrently, so this is the floor, not slack. Declared rather than left
  // warning on every run — a warning that can never be actioned is noise, and
  // noise is how real warnings get ignored.
  slow: true,
});

component("exposes the component work clock for runtime audit", {
  then: ["the clock is a work clock, not the wall", () => {
    expect(["native", "schedstat", "process-cpu-degraded"]).toContain(component.workClock);
  }],
});
