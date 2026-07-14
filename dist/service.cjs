"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/service.ts
var service_exports = {};
__export(service_exports, {
  assertPerformance: () => assertPerformance,
  autoCleanup: () => autoCleanup,
  measureMs: () => measureMs,
  startCluster: () => startCluster,
  startService: () => startService
});
module.exports = __toCommonJS(service_exports);
var import_node_child_process = require("child_process");
var import_node_fs = require("fs");
var import_node_os = require("os");
var import_vitest = require("vitest");
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
  if (requires?.minRamMb !== void 0) {
    const availableRamMb = Math.round((0, import_node_os.totalmem)() / 1024 / 1024);
    if (availableRamMb < requires.minRamMb) {
      throw new Error(
        `[${name}] Requires ${requires.minRamMb}MB RAM but host has ${availableRamMb}MB`
      );
    }
  }
  if (requires?.gpu || requires?.minVramMb !== void 0) {
    const gpuMemoryMb = getGpuMemoryMb();
    if (gpuMemoryMb === null) {
      throw new Error(
        `[${name}] Requires GPU but none detected. Skip with: integration.skip(...)`
      );
    }
    if (requires.minVramMb !== void 0 && gpuMemoryMb < requires.minVramMb) {
      throw new Error(
        `[${name}] Requires ${requires.minVramMb}MB VRAM but largest GPU has ${gpuMemoryMb}MB`
      );
    }
  }
  const startedAt = Date.now();
  const proc = (0, import_node_child_process.spawn)(command, args, {
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
  (0, import_vitest.afterAll)(async () => {
    if ("stopAll" in service) {
      await service.stopAll();
    } else {
      await service.stop();
    }
  });
}
function assertPerformance(service, requirements, measurements = {}) {
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
  if (requirements.maxResponseMs !== void 0) {
    if (measurements.responseMs === void 0) {
      throw new Error(
        `[${service.name}] maxResponseMs requires measurements.responseMs`
      );
    }
    if (measurements.responseMs > requirements.maxResponseMs) {
      throw new Error(
        `[${service.name}] Response too slow: ${measurements.responseMs}ms > ${requirements.maxResponseMs}ms`
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
    let interval;
    let pollTimer;
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
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      fail(new Error(
        `[${name}] Not ready within ${timeoutMs}ms.
Output: ${getOutput().slice(-500)}`
      ));
    }, timeoutMs);
    const failIfExited = () => {
      if (proc.exitCode === null && proc.signalCode === null) return false;
      fail(
        new Error(
          `[${name}] Exited before ready.
Output: ${getOutput().slice(-500)}`
        )
      );
      return true;
    };
    if (ready.signal) {
      const check = () => {
        if (getOutput().includes(ready.signal)) {
          succeed();
          return true;
        }
        return false;
      };
      interval = setInterval(() => {
        if (check()) return;
        failIfExited();
      }, 50);
    } else if (ready.url) {
      const pollMs = ready.pollMs ?? 500;
      const poll = async () => {
        if (settled || failIfExited()) return;
        try {
          const res = await fetch(ready.url, {
            signal: AbortSignal.timeout(1e3)
          });
          if (res.ok) {
            succeed();
            return;
          }
        } catch {
        }
        if (!settled) pollTimer = setTimeout(poll, pollMs);
      };
      void poll();
    } else {
      fail(new Error(`[${name}] No ready signal or URL configured`));
    }
  });
}
async function stopProcess(proc, name, timeoutMs) {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
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
function getProcessMemory(pid) {
  try {
    const status = (0, import_node_fs.readFileSync)(`/proc/${pid}/status`, "utf-8");
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
    return match ? Math.round(Number(match[1]) / 1024) : null;
  } catch {
    return null;
  }
}
function getGpuMemoryMb() {
  try {
    const output = (0, import_node_child_process.execFileSync)(
      "nvidia-smi",
      ["--query-gpu=memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const values = output.split(/\r?\n/).map((value) => Number.parseInt(value.trim(), 10)).filter(Number.isFinite);
    return values.length > 0 ? Math.max(...values) : null;
  } catch {
    return null;
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  assertPerformance,
  autoCleanup,
  measureMs,
  startCluster,
  startService
});
