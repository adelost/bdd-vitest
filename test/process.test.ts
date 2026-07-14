import { feature, component, expect } from "../src/index.js";
import { startProcess } from "../src/process.js";

feature("startProcess()", () => {
  component("force-kills a process that ignores SIGTERM", {
    given: ["a child that ignores SIGTERM", () => startProcess({
      command: process.execPath,
      args: ["-e", "process.on('SIGTERM', () => {}); console.log('READY'); setInterval(() => {}, 1000)"],
      readySignal: "READY",
      timeoutMs: 2_000,
      stopTimeoutMs: 100,
    })],
    when: ["stopping it with a short grace period", async (managed) => {
      const started = performance.now();
      await managed.kill();
      return { elapsed: performance.now() - started, managed };
    }],
    then: ["it exits after the fallback SIGKILL", ({ elapsed, managed }) => {
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(1_000);
      expect(managed.process.exitCode !== null || managed.process.signalCode !== null).toBe(true);
    }],
    slow: true,
  });

  component("rejects a clean exit before readiness", {
    when: ["starting a child that exits zero immediately", () => startProcess({
      command: process.execPath,
      args: ["-e", "process.exit(0)"],
      readySignal: "NEVER",
      timeoutMs: 2_000,
    }).catch((error: Error) => error)],
    then: ["the early exit is reported without waiting for timeout", (error) => {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("before ready");
    }],
  });
});
