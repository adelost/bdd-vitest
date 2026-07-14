/**
 * Mock AI provider for testing — never calls real APIs.
 *
 * Usage:
 *   import { createMockProvider, createMockAuthProfiles } from "bdd-vitest/mock-ai";
 */
interface MockProviderOptions {
    /** Simulated response latency in ms (default: 10) */
    latencyMs?: number;
    /** Default response text */
    response?: string;
    /** Simulate failure after N requests */
    failAfter?: number;
    /** Error message on failure */
    errorMessage?: string;
}
interface MockProviderStats {
    totalRequests: number;
    activeRequests: number;
    maxConcurrent: number;
    requestLog: Array<{
        model: string;
        timestamp: number;
        durationMs: number;
    }>;
}
declare function createMockProvider(options?: MockProviderOptions): {
    complete: (model: string, _messages: unknown[]) => Promise<{
        id: string;
        object: "chat.completion";
        created: number;
        model: string;
        choices: {
            index: number;
            message: {
                role: "assistant";
                content: string;
            };
            finish_reason: "stop";
        }[];
        usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
        };
    }>;
    stats: MockProviderStats;
    reset: () => void;
};
interface MockAuthProfile {
    type: string;
    provider: string;
    access: string;
    refresh: string;
    expires: number;
}
/**
 * Creates a mock auth-profiles.json structure.
 * Tokens are obviously fake — never hit real APIs.
 */
declare function createMockAuthProfiles(providers?: string[]): Record<string, MockAuthProfile>;
/**
 * Creates expired mock credentials for testing refresh flows.
 */
declare function createExpiredMockAuthProfiles(providers?: string[]): Record<string, MockAuthProfile>;

export { type MockAuthProfile, type MockProviderOptions, type MockProviderStats, createExpiredMockAuthProfiles, createMockAuthProfiles, createMockProvider };
