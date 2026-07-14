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
interface ServiceConfig {
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
    startTimeoutMs?: number;
    stopTimeoutMs?: number;
    /** Resource requirements (documented, checked if possible) */
    requires?: {
        gpu?: boolean;
        minRamMb?: number;
        minVramMb?: number;
    };
}
interface RunningService {
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
interface ProcessStats {
    pid: number;
    uptimeMs: number;
    /** RSS memory in MB (from /proc or ps) */
    memoryMb: number | null;
}
declare function startService(config: ServiceConfig): Promise<RunningService>;
interface ServiceCluster {
    services: RunningService[];
    /** Stop all in reverse order */
    stopAll: () => Promise<void>;
    /** Get service by name */
    get: (name: string) => RunningService | undefined;
    /** Are all services alive? */
    isHealthy: () => Promise<boolean>;
}
declare function startCluster(configs: ServiceConfig[]): Promise<ServiceCluster>;
/**
 * Register a service for automatic cleanup after all tests.
 * Use in beforeAll:
 *   const srv = await startService(config);
 *   autoCleanup(srv);
 */
declare function autoCleanup(service: RunningService | ServiceCluster): void;
interface PerformanceRequirement {
    /** Max startup time */
    maxStartupMs?: number;
    /** Max memory usage */
    maxMemoryMb?: number;
    /** Max response time for a single request */
    maxResponseMs?: number;
}
interface PerformanceMeasurements {
    /** Measured response time, for example from measureMs(). */
    responseMs?: number;
}
/**
 * Assert performance requirements on a running service.
 */
declare function assertPerformance(service: RunningService, requirements: PerformanceRequirement, measurements?: PerformanceMeasurements): void;
/**
 * Measure response time of an async operation.
 */
declare function measureMs<T>(fn: () => Promise<T>): Promise<{
    result: T;
    ms: number;
}>;

export { type PerformanceMeasurements, type PerformanceRequirement, type ProcessStats, type RunningService, type ServiceCluster, type ServiceConfig, assertPerformance, autoCleanup, measureMs, startCluster, startService };
