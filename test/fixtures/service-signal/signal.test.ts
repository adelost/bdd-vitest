import { component } from "../../../src/index.js";
import { startService } from "../../../src/service.js";

component("kills a tracked service on worker termination", {
  given: ["a tracked child service", () => startService({
    name: "signal-child",
    command: process.execPath,
    args: ["-e", "console.log('READY'); setInterval(() => {}, 1000)"],
    ready: { signal: "READY" },
  })],
  then: ["SIGTERM exits through the service cleanup handler", async (service) => {
    console.log(`BDD_SERVICE_PID=${service.pid}`);
    process.kill(process.pid, "SIGTERM");
    await new Promise(() => {});
  }],
});
