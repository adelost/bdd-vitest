/**
 * Process helpers — start/stop backend services in tests.
 *
 * Usage:
 *   import { startProcess } from "bdd-vitest/process";
 *
 *   const proc = await startProcess({
 *     command: "uv", args: ["run", "python", "server.py"],
 *     readySignal: "Listening on port",
 *     timeoutMs: 10_000,
 *   });
 *   // ... test ...
 *   proc.kill();
 */

import { spawn, type ChildProcess } from "node:child_process";

export interface StartProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** String in stdout/stderr that signals the process is ready */
  readySignal: string;
  /** Max time to wait for ready signal (default: 15s) */
  timeoutMs?: number;
  /** Grace period after SIGTERM before SIGKILL (default: 5s) */
  stopTimeoutMs?: number;
}

export interface ManagedProcess {
  process: ChildProcess;
  pid: number;
  /** Collected stdout up to ready signal */
  stdout: string;
  /** Kill the process and wait for exit */
  kill: () => Promise<void>;
}

export async function startProcess(
  options: StartProcessOptions,
): Promise<ManagedProcess> {
  const {
    command,
    args = [],
    cwd,
    env,
    readySignal,
    timeoutMs = 15_000,
    stopTimeoutMs = 5_000,
  } = options;

  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";

  return new Promise<ManagedProcess>((resolve, reject) => {
    let settled = false;

    const cleanupStartupListeners = () => {
      clearTimeout(timeout);
      proc.stdout?.off("data", onData);
      proc.stderr?.off("data", onData);
      proc.off("error", onError);
      proc.off("exit", onExit);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanupStartupListeners();
      void stopChild(proc, 250).finally(() => reject(error));
    };

    const onData = (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(readySignal)) {
        if (settled) return;
        settled = true;
        cleanupStartupListeners();
        resolve({
          process: proc,
          pid: proc.pid!,
          stdout,
          kill: () => stopChild(proc, stopTimeoutMs),
        });
      }
    };

    const onError = (error: Error) => {
      fail(new Error(`Failed to start "${command}": ${error.message}`));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      fail(new Error(`Process "${command}" exited with ${reason} before ready.\nStdout: ${stdout}`));
    };

    const timeout = setTimeout(() => {
      fail(new Error(
        `Process "${command}" did not emit "${readySignal}" within ${timeoutMs}ms.\nStdout: ${stdout}`,
      ));
    }, timeoutMs);

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("error", onError);
    proc.once("exit", onExit);
  });
}

function stopChild(proc: ChildProcess, timeoutMs: number): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve();

  return new Promise<void>((resolve) => {
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
