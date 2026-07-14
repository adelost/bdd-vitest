import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "vitest";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("cleanup never hides the primary scenario failure", () => {
  const result = spawnSync(
    process.execPath,
    [
      resolve(projectRoot, "node_modules/vitest/vitest.mjs"),
      "run",
      "test/fixtures/cleanup-aggregate.test.ts",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, BDD_VITEST_CLEANUP_FAILURE: "1", NO_COLOR: "1" },
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;

  expect(result.status).toBe(1);
  expect(output).toContain("scenario and cleanup both failed");
  expect(output).toContain("primary broke");
  expect(output).toContain("cleanup broke");
  expect(output).toContain("[unit/then] retains behavior and cleanup failures");
  expect(output).toContain("[unit/cleanup] retains behavior and cleanup failures");
});
