// src/process.ts
import { spawn } from "child_process";
async function startProcess(options) {
  const {
    command,
    args = [],
    cwd,
    env,
    readySignal,
    timeoutMs = 15e3,
    stopTimeoutMs = 5e3
  } = options;
  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanupStartupListeners = () => {
      clearTimeout(timeout);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onExit);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanupStartupListeners();
      void stopChild(proc, 250).finally(() => reject(error));
    };
    const onData = (chunk) => {
      stdout += chunk.toString();
      if (stdout.includes(readySignal)) {
        if (settled) return;
        settled = true;
        cleanupStartupListeners();
        resolve({
          process: proc,
          pid: proc.pid,
          stdout,
          kill: () => stopChild(proc, stopTimeoutMs)
        });
      }
    };
    const onError = (error) => {
      fail(new Error(`Failed to start "${command}": ${error.message}`));
    };
    const onExit = (code, signal) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      fail(new Error(`Process "${command}" exited with ${reason} before ready.
Stdout: ${stdout}`));
    };
    const timeout = setTimeout(() => {
      fail(new Error(
        `Process "${command}" did not emit "${readySignal}" within ${timeoutMs}ms.
Stdout: ${stdout}`
      ));
    }, timeoutMs);
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("error", onError);
    proc.once("exit", onExit);
  });
}
function stopChild(proc, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceKill);
      proc.off("exit", finish);
      resolve();
    };
    const forceKill = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        try {
          proc.kill("SIGKILL");
        } catch {
          finish();
        }
      } else {
        finish();
      }
    }, timeoutMs);
    proc.once("exit", finish);
    try {
      if (!proc.kill("SIGTERM")) finish();
    } catch {
      finish();
    }
  });
}
export {
  startProcess
};
