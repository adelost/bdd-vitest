import { ChildProcess } from 'node:child_process';

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

interface StartProcessOptions {
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
interface ManagedProcess {
    process: ChildProcess;
    pid: number;
    /** Collected stdout up to ready signal */
    stdout: string;
    /** Kill the process and wait for exit */
    kill: () => Promise<void>;
}
declare function startProcess(options: StartProcessOptions): Promise<ManagedProcess>;

export { type ManagedProcess, type StartProcessOptions, startProcess };
