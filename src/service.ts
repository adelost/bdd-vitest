/**
 * Declarative service helpers for component/integration tests.
 *
 * Fool-proof: auto-cleanup, zombie protection, resource tracking.
 *
 * Usage:
 *   import { service, serviceCluster } from "bdd-vitest/service";
 *
 *   // Single service
 *   const api = service({
 *     name: "ai-dsl-api",
 *     command: "uv", args: ["run", "python", "server.py"],
 *     ready: { signal: "Listening on port 8000" },
 *     health: { url: "http://localhost:8000/health" },
 *   });
 *
 *   // Multiple services
 *   const cluster = serviceCluster([api, redis, worker]);
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { afterAll } from "vitest";

// --- Zombie protection: track ALL spawned processes ---
const activeProcesses = new Set<ChildProcess>();

function registerProcess(proc: ChildProcess) {
  activeProcesses.add(proc);
  proc.on("exit", () => activeProcesses.delete(proc));
}

// Kill all on unexpected exit (zombies)
function killAll() {
  for (const proc of activeProcesses) {
    try {
      proc.kill("SIGKILL");
    } catch {
      // already dead
    }
  }
  activeProcesses.clear();
}

process.on("exit", killAll);
process.once("SIGINT", () => {
  killAll();
  process.exit(130);
});
process.once("SIGTERM", () => {
  killAll();
  process.exit(143);
});

// --- Service definition (declarative) ---

export interface ServiceConfig {
  /** Human-readable name (for error messages) */
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;

  /** How to know the service is ready */
  ready: {
    /** String in stdout/stderr */
    signal?: string;
    /** HTTP endpoint to poll */
    url?: string;
    /** Poll interval for URL check (default: 500ms) */
    pollMs?: number;
  };

  /** Optional health check (for ongoing monitoring) */
  health?: {
    url: string;
  };

  /** Timeouts */
  startTimeoutMs?: number; // default: 15s
  stopTimeoutMs?: number; // default: 5s

  /** Resource requirements (documented, checked if possible) */
  requires?: {
    gpu?: boolean;
    minRamMb?: number;
    minVramMb?: number;
  };
}

export interface RunningService {
  name: string;
  pid: number;
  stdout: string;
  stderr: string;
  /** Time it took to start */
  startupMs: number;
  /** Check if process is still alive */
  isAlive: () => boolean;
  /** Health check (if configured) */
  isHealthy: () => Promise<boolean>;
  /** Kill and wait for exit */
  stop: () => Promise<void>;
  /** Resource stats at time of query */
  stats: () => ProcessStats;
}

export interface ProcessStats {
  pid: number;
  uptimeMs: number;
  /** RSS memory in MB (from /proc or ps) */
  memoryMb: number | null;
}

// --- Start a service ---

export async function startService(
  config: ServiceConfig,
): Promise<RunningService> {
  const {
    name,
    command,
    args = [],
    cwd,
    env,
    ready,
    health,
    startTimeoutMs = 15_000,
    stopTimeoutMs = 5_000,
    requires,
  } = config;

  // Check requirements before starting
  if (requires?.minRamMb !== undefined) {
    const hostRamMb = Math.round(totalmem() / 1024 / 1024);
    if (hostRamMb < requires.minRamMb) {
      throw new Error(
        `[${name}] Requires ${requires.minRamMb}MB RAM but host has ${hostRamMb}MB`,
      );
    }
  }

  if (requires?.gpu || requires?.minVramMb !== undefined) {
    const gpuMemoryMb = getGpuMemoryMb();
    if (gpuMemoryMb === null) {
      throw new Error(
        `[${name}] Requires GPU but none detected. Skip with: integration.skip(...)`,
      );
    }
    if (requires.minVramMb !== undefined && gpuMemoryMb < requires.minVramMb) {
      throw new Error(
        `[${name}] Requires ${requires.minVramMb}MB VRAM but largest GPU has ${gpuMemoryMb}MB`,
      );
    }
  }

  const startedAt = Date.now();
  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  registerProcess(proc);

  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // Wait for ready
  await waitForReady(proc, name, ready, startTimeoutMs, () => stdout + stderr);

  const startupMs = Date.now() - startedAt;

  const service: RunningService = {
    name,
    pid: proc.pid!,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    startupMs,

    isAlive: () => !proc.killed && proc.exitCode === null,

    isHealthy: async () => {
      if (!health?.url) return service.isAlive();
      try {
        const res = await fetch(health.url, { signal: AbortSignal.timeout(2000) });
        return res.ok;
      } catch {
        return false;
      }
    },

    stop: () => stopProcess(proc, name, stopTimeoutMs),

    stats: () => ({
      pid: proc.pid!,
      uptimeMs: Date.now() - startedAt,
      memoryMb: getProcessMemory(proc.pid!),
    }),
  };

  return service;
}

// --- Service cluster (multiple services, ordered start/stop) ---

export interface ServiceCluster {
  services: RunningService[];
  /** Stop all in reverse order */
  stopAll: () => Promise<void>;
  /** Get service by name */
  get: (name: string) => RunningService | undefined;
  /** Are all services alive? */
  isHealthy: () => Promise<boolean>;
}

export async function startCluster(
  configs: ServiceConfig[],
): Promise<ServiceCluster> {
  const services: RunningService[] = [];

  try {
    for (const config of configs) {
      const service = await startService(config);
      services.push(service);
    }
  } catch (error) {
    // Cleanup already-started services on failure
    for (const s of services.reverse()) {
      await s.stop().catch(() => {});
    }
    throw error;
  }

  return {
    services,
    stopAll: async () => {
      for (const s of [...services].reverse()) {
        await s.stop().catch(() => {});
      }
    },
    get: (name) => services.find((s) => s.name === name),
    isHealthy: async () => {
      const results = await Promise.all(services.map((s) => s.isHealthy()));
      return results.every(Boolean);
    },
  };
}

// --- Auto-cleanup for vitest ---

/**
 * Register a service for automatic cleanup after all tests.
 * Use in beforeAll:
 *   const srv = await startService(config);
 *   autoCleanup(srv);
 */
export function autoCleanup(service: RunningService | ServiceCluster) {
  afterAll(async () => {
    if ("stopAll" in service) {
      await service.stopAll();
    } else {
      await service.stop();
    }
  });
}

// --- Performance assertions ---

export interface PerformanceRequirement {
  /** Max startup time */
  maxStartupMs?: number;
  /** Max memory usage */
  maxMemoryMb?: number;
  /** Max response time for a single request */
  maxResponseMs?: number;
}

export interface PerformanceMeasurements {
  /** Measured response time, for example from measureMs(). */
  responseMs?: number;
}

/**
 * Assert performance requirements on a running service.
 */
export function assertPerformance(
  service: RunningService,
  requirements: PerformanceRequirement,
  measurements: PerformanceMeasurements = {},
) {
  if (requirements.maxStartupMs !== undefined) {
    if (service.startupMs > requirements.maxStartupMs) {
      throw new Error(
        `[${service.name}] Startup too slow: ${service.startupMs}ms > ${requirements.maxStartupMs}ms`,
      );
    }
  }

  if (requirements.maxMemoryMb !== undefined) {
    const stats = service.stats();
    if (stats.memoryMb !== null && stats.memoryMb > requirements.maxMemoryMb) {
      throw new Error(
        `[${service.name}] Memory too high: ${stats.memoryMb}MB > ${requirements.maxMemoryMb}MB`,
      );
    }
  }

  if (requirements.maxResponseMs !== undefined) {
    if (measurements.responseMs === undefined) {
      throw new Error(
        `[${service.name}] maxResponseMs requires measurements.responseMs`,
      );
    }
    if (measurements.responseMs > requirements.maxResponseMs) {
      throw new Error(
        `[${service.name}] Response too slow: ${measurements.responseMs}ms > ${requirements.maxResponseMs}ms`,
      );
    }
  }
}

/**
 * Measure response time of an async operation.
 */
export async function measureMs<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}

// --- Internal helpers ---

async function waitForReady(
  proc: ChildProcess,
  name: string,
  ready: ServiceConfig["ready"],
  timeoutMs: number,
  getOutput: () => string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let interval: ReturnType<typeof setInterval> | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
      if (pollTimer) clearTimeout(pollTimer);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      fail(new Error(
        `[${name}] Not ready within ${timeoutMs}ms.\nOutput: ${getOutput().slice(-500)}`,
      ));
    }, timeoutMs);

    const failIfExited = () => {
      if (proc.exitCode === null && proc.signalCode === null) return false;
      fail(
        new Error(
          `[${name}] Exited before ready.\nOutput: ${getOutput().slice(-500)}`,
        ),
      );
      return true;
    };

    if (ready.signal) {
      const check = () => {
        if (getOutput().includes(ready.signal!)) {
          succeed();
          return true;
        }
        return false;
      };

      // Check on each stdout/stderr chunk
      interval = setInterval(() => {
        if (check()) return;
        failIfExited();
      }, 50);
    } else if (ready.url) {
      const pollMs = ready.pollMs ?? 500;
      const poll = async () => {
        if (settled || failIfExited()) return;
        try {
          const res = await fetch(ready.url!, {
            signal: AbortSignal.timeout(1000),
          });
          if (res.ok) {
            succeed();
            return;
          }
        } catch {
          // not ready yet
        }
        if (!settled) pollTimer = setTimeout(poll, pollMs);
      };
      void poll();
    } else {
      fail(new Error(`[${name}] No ready signal or URL configured`));
    }
  });
}

async function stopProcess(
  proc: ChildProcess,
  name: string,
  timeoutMs: number,
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;

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
          if (!proc.kill("SIGKILL")) finish();
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

function getProcessMemory(pid: number): number | null {
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}

function getGpuMemoryMb(): number | null {
  try {
    const output = execFileSync(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const values = output
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter(Number.isFinite);
    return values.length > 0 ? Math.max(...values) : null;
  } catch {
    return null;
  }
}
