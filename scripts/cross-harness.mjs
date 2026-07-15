import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pytestRoot = resolve(process.env.BDD_PYTEST_ROOT ?? join(root, "..", "bdd-pytest"));
const pytestPython = resolve(
  process.env.BDD_PYTEST_PYTHON ?? join(pytestRoot, ".venv", "bin", "python"),
);
const vitestBin = resolve(root, "node_modules", "vitest", "vitest.mjs");

assert.ok(existsSync(pytestPython), `pytest Python not found: ${pytestPython}`);

const execute = (command, args, cwd, env) => {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, NO_COLOR: "1", ...env },
    encoding: "utf8",
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
  );
};

const semanticRun = (report) => ({
  status: report.run.status,
  summary: report.summary,
  tests: report.tests.map((test) => ({
    level: test.level,
    documentation: test.documentation,
    scenarios: test.scenarios,
    status: test.status,
    retryCount: test.retryCount,
    flaky: test.flaky,
  })),
});

const directory = mkdtempSync(join(tmpdir(), "bdd-cross-harness-"));
try {
  const vitestReport = join(directory, "vitest.json");
  const pytestReport = join(directory, "pytest.json");
  const provenance = {
    BDD_REPORT_PROJECT: "checkout",
    BDD_REPORT_REPOSITORY: "adelost/checkout",
    BDD_REPORT_COMMIT_SHA: "0123456789abcdef",
    BDD_REPORT_BRANCH: "main",
  };

  execute(
    process.execPath,
    [vitestBin, "run", "--root", "test/fixtures/cross-harness"],
    root,
    { ...provenance, BDD_REPORT_FILE: vitestReport },
  );
  execute(
    pytestPython,
    ["-m", "pytest", "conformance/catalog.py", "-q", `--bdd-report-json=${pytestReport}`],
    pytestRoot,
    provenance,
  );

  const reports = [vitestReport, pytestReport].map((path) =>
    JSON.parse(readFileSync(path, "utf8")));
  const schema = JSON.parse(
    readFileSync(join(root, "schema", "bdd.run.v1.schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  for (const report of reports) {
    assert.ok(validate(report), ajv.errorsText(validate.errors, { separator: "\n" }));
  }
  assert.deepEqual(
    semanticRun(reports[0]),
    semanticRun(reports[1]),
    "bdd-vitest and bdd-pytest emitted different semantics for the same scenario",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
