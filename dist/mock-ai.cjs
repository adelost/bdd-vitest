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

// src/mock-ai.ts
var mock_ai_exports = {};
__export(mock_ai_exports, {
  createExpiredMockAuthProfiles: () => createExpiredMockAuthProfiles,
  createMockAuthProfiles: () => createMockAuthProfiles,
  createMockProvider: () => createMockProvider
});
module.exports = __toCommonJS(mock_ai_exports);
function createMockProvider(options = {}) {
  const {
    latencyMs = 10,
    response = "Mock response",
    failAfter = Infinity,
    errorMessage = "Mock provider error"
  } = options;
  const stats = {
    totalRequests: 0,
    activeRequests: 0,
    maxConcurrent: 0,
    requestLog: []
  };
  async function complete(model, _messages) {
    stats.totalRequests++;
    stats.activeRequests++;
    stats.maxConcurrent = Math.max(stats.maxConcurrent, stats.activeRequests);
    if (stats.totalRequests > failAfter) {
      stats.activeRequests--;
      throw new Error(errorMessage);
    }
    const start = Date.now();
    await new Promise((r) => setTimeout(r, latencyMs));
    const durationMs = Date.now() - start;
    stats.activeRequests--;
    stats.requestLog.push({ model, timestamp: start, durationMs });
    return {
      id: `mock-${stats.totalRequests}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1e3),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: response },
          finish_reason: "stop"
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15
      }
    };
  }
  function reset() {
    stats.totalRequests = 0;
    stats.activeRequests = 0;
    stats.maxConcurrent = 0;
    stats.requestLog = [];
  }
  return { complete, stats, reset };
}
function createMockAuthProfiles(providers = ["openai-codex", "anthropic", "google-gemini-cli"]) {
  const profiles = {};
  for (const provider of providers) {
    const profileId = provider === "google-gemini-cli" ? `${provider}:test@example.com` : `${provider}:default`;
    profiles[profileId] = {
      type: "oauth",
      provider,
      access: `mock-access-${provider}`,
      refresh: `mock-refresh-${provider}`,
      expires: Date.now() + 36e5
      // 1h from now
    };
  }
  return profiles;
}
function createExpiredMockAuthProfiles(providers = ["openai-codex"]) {
  const profiles = createMockAuthProfiles(providers);
  for (const profile of Object.values(profiles)) {
    profile.expires = Date.now() - 36e5;
  }
  return profiles;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createExpiredMockAuthProfiles,
  createMockAuthProfiles,
  createMockProvider
});
