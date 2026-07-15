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
