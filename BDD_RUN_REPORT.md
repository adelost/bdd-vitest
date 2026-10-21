# `bdd.run.v1`

`bdd.run.v1` is the canonical, framework-neutral test catalog and run-result
contract emitted by bdd-vitest and bdd-pytest. Its normative JSON Schema lives
at [`schema/bdd.run.v1.schema.json`](./schema/bdd.run.v1.schema.json); the schema
is defined here once and both harnesses are held to it by a cross-harness gate.

The report contains one run envelope, aggregate counts, and one record per
collected test. Each test records its stable ID, repository-relative file,
test level (`unit`, `component`, `integration`, or `e2e`), documentation source,
scenario phases, status, duration, retries, and flaky state.

## Compatibility

- Consumers must select behavior from `schemaVersion` and reject unknown or
  future versions. They must not guess.
- Producers must use repository-relative `/`-separated paths. Absolute local
  paths are invalid.
- Missing CI provenance is represented by `null`, never an invented value.
- Reports intentionally exclude console output, stack traces, environment
  values, and local process information. Rich logs belong in separately
  access-controlled artifacts.
- Test IDs are deterministic within a framework. Consumers must not infer
  meaning from the ID or expect Vitest and pytest IDs to be equal.
- `flaky` has one framework-neutral definition: `retryCount > 0` and the final
  status is `passed`. A test that still fails after retries is not marked flaky.
- Timestamps and durations describe the particular execution and are not part
  of semantic cross-harness equivalence. pytest includes setup, call, teardown,
  and every retry; Vitest reports its framework diagnostic duration. Compare
  trends within one framework, not absolute timing across frameworks.
- pytest can use a test-function docstring as documentation, while bdd-vitest's
  level runner always emits a structured scenario. This is why `docstring` is a
  valid documentation source even though Vitest itself never produces it.

## Emitting a report

Both harnesses honor the same environment variables:

```text
BDD_REPORT_FILE=/artifacts/bdd-run.json
BDD_REPORT_PROJECT=checkout
BDD_REPORT_REPOSITORY=adelost/checkout
BDD_REPORT_COMMIT_SHA=<git SHA>
BDD_REPORT_BRANCH=main
```

bdd-vitest's `bddConfig()` enables the reporter when `BDD_REPORT_FILE` is set.
On Vitest 3 and newer it also survives a CI command overriding the display
reporter with `--reporter`. Vitest 2 consumers should configure display
reporters through `bddConfig({ test: { reporters: [...] } })`; Vitest 2 replaces
all config reporters when its CLI flag is used.
It is also available directly as `bddRunReporter()` from `bdd-vitest/report`.
bdd-pytest accepts `--bdd-report-json PATH`; `BDD_REPORT_FILE` is its fallback.

Report files are written atomically so an interrupted producer cannot leave a
partially valid document at the requested path.

## Repository directory mode and v2

Opt in once in Vitest config with `bddConfig({ bddReport: { directory: true }, ... })`.
Pytest supports `bdd_report_directory = true` in its ini configuration, or
`enable_run_reports(config)` from `bdd_pytest` in an existing `pytest_configure` hook.
No environment variable is needed for subsequent ordinary runs.

Each run writes `<git-common-dir>/bdd-runs/<startedAtMilliseconds>-<pid>.json`
atomically. Linked worktrees share this directory, concurrent processes use distinct
names. Git HEAD, branch and status are read at run start and finish. The recorded
commit is null if either tree is dirty, HEAD moves, or Git is unavailable; environment
provenance cannot override it. The branch is the observed starting branch, null when
detached. Retention removes oldest reports until both 200 files and 500,000,000 bytes
remain. Report IO failures emit one diagnostic without changing the test/run result.

Directory reports use [`bdd.run.v2`](schema/bdd.run.v2.schema.json). It adds required
nullable `budget: {ms, clock: "work" | "wall"}` and `measuredMs` on each test.
Vitest's level owner exports its actual work or wall measurement, including failed
executions and outlines. Its work clock counts current-thread CPU and declared async
waits, not scheduling gaps around synchronous phases. Pytest's budgets are wall-clock
timeouts and its measurement covers the test protocol. Skipped/unmeasured tests stay
null. Tests without a known level/budget stay null. Do not compare `durationMs` to a
work budget: the former remains the framework's wall diagnostic.

The original explicit output-file mode remains v1 by default. Select v2 there with
`BDD_REPORT_SCHEMA=bdd.run.v2`, `schemaVersion: "bdd.run.v2"` in Vitest's reporter
options, or `--bdd-report-schema=bdd.run.v2` in pytest. v1 schema/output remain valid.
The cross-harness gate validates both producers against v2 and the shared fixture
`test/fixtures/run-v2.json`; clocks/budgets may differ by framework by design.
