import {
  __require
} from "./chunk-3RG5ZIWI.js";

// src/service.ts
import { spawn } from "child_process";
import { afterAll } from "vitest";
var activeProcesses = /* @__PURE__ */ new Set();
function registerProcess(proc) {
  activeProcesses.add(proc);
  proc.on("exit", () => activeProcesses.delete(proc));
}
function killAll() {
  for (const proc of activeProcesses) {
    try {
      proc.kill("SIGKILL");
    } catch {
    }
  }
  activeProcesses.clear();
}
process.on("exit", killAll);
process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);
process.on("uncaughtException", killAll);
async function startService(config) {
  const {
    name,
    command,
    args = [],
    cwd,
    env,
    ready,
    health,
    startTimeoutMs = 15e3,
    stopTimeoutMs = 5e3,
    requires
  } = config;
  if (requires?.gpu) {
    const hasGpu = await checkGpu();
    if (!hasGpu) {
      throw new Error(
        `[${name}] Requires GPU but none detected. Skip with: integration.skip(...)`
      );
    }
  }
  const startedAt = Date.now();
  const proc = spawn(command, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  registerProcess(proc);
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  await waitForReady(proc, name, ready, startTimeoutMs, () => stdout + stderr);
  const startupMs = Date.now() - startedAt;
  const service = {
    name,
    pid: proc.pid,
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
        const res = await fetch(health.url, { signal: AbortSignal.timeout(2e3) });
        return res.ok;
      } catch {
        return false;
      }
    },
    stop: () => stopProcess(proc, name, stopTimeoutMs),
    stats: () => ({
      pid: proc.pid,
      uptimeMs: Date.now() - startedAt,
      memoryMb: getProcessMemory(proc.pid)
    })
  };
  return service;
}
async function startCluster(configs) {
  const services = [];
  try {
    for (const config of configs) {
      const service = await startService(config);
      services.push(service);
    }
  } catch (error) {
    for (const s of services.reverse()) {
      await s.stop().catch(() => {
      });
    }
    throw error;
  }
  return {
    services,
    stopAll: async () => {
      for (const s of [...services].reverse()) {
        await s.stop().catch(() => {
        });
      }
    },
    get: (name) => services.find((s) => s.name === name),
    isHealthy: async () => {
      const results = await Promise.all(services.map((s) => s.isHealthy()));
      return results.every(Boolean);
    }
  };
}
function autoCleanup(service) {
  afterAll(async () => {
    if ("stopAll" in service) {
      await service.stopAll();
    } else {
      await service.stop();
    }
  });
}
function assertPerformance(service, requirements) {
  if (requirements.maxStartupMs !== void 0) {
    if (service.startupMs > requirements.maxStartupMs) {
      throw new Error(
        `[${service.name}] Startup too slow: ${service.startupMs}ms > ${requirements.maxStartupMs}ms`
      );
    }
  }
  if (requirements.maxMemoryMb !== void 0) {
    const stats = service.stats();
    if (stats.memoryMb !== null && stats.memoryMb > requirements.maxMemoryMb) {
      throw new Error(
        `[${service.name}] Memory too high: ${stats.memoryMb}MB > ${requirements.maxMemoryMb}MB`
      );
    }
  }
}
async function measureMs(fn) {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}
async function waitForReady(proc, name, ready, timeoutMs, getOutput) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new Error(
          `[${name}] Not ready within ${timeoutMs}ms.
Output: ${getOutput().slice(-500)}`
        )
      );
    }, timeoutMs);
    if (ready.signal) {
      const check = () => {
        if (getOutput().includes(ready.signal)) {
          clearTimeout(timeout);
          resolve();
          return true;
        }
        return false;
      };
      const interval = setInterval(() => {
        if (check()) clearInterval(interval);
        if (proc.exitCode !== null) {
          clearInterval(interval);
          clearTimeout(timeout);
          reject(
            new Error(
              `[${name}] Exited with code ${proc.exitCode} before ready.
Output: ${getOutput().slice(-500)}`
            )
          );
        }
      }, 50);
    } else if (ready.url) {
      const pollMs = ready.pollMs ?? 500;
      const interval = setInterval(async () => {
        try {
          const res = await fetch(ready.url, {
            signal: AbortSignal.timeout(1e3)
          });
          if (res.ok) {
            clearInterval(interval);
            clearTimeout(timeout);
            resolve();
          }
        } catch {
        }
      }, pollMs);
    } else {
      clearTimeout(timeout);
      reject(new Error(`[${name}] No ready signal or URL configured`));
    }
  });
}
async function stopProcess(proc, name, timeoutMs) {
  if (proc.killed || proc.exitCode !== null) return;
  return new Promise((resolve) => {
    const forceKill = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
      }
      resolve();
    }, timeoutMs);
    proc.on("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    proc.kill("SIGTERM");
  });
}
function getProcessMemory(pid) {
  try {
    const fs = __require("fs");
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}
async function checkGpu() {
  try {
    const { execSync } = __require("child_process");
    execSync("nvidia-smi", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
export {
  assertPerformance,
  autoCleanup,
  measureMs,
  startCluster,
  startService
};
