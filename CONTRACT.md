# bdd-vitest contract

The contract exists so tests remain executable documentation rather than only
executable code.

## Required invariants

1. Every test has exactly one level: `unit`, `component`, `integration`, or `e2e`.
2. Every scenario and phase description is non-empty.
3. Every test has a `then` phase. This guarantees an explicit outcome phase;
   the assertion library itself is intentionally not prescribed.
4. Cleanup runs after the scenario even when a phase fails. If both fail, both
   errors are retained.
5. Every registered test carries JSON-serializable `meta.bdd` documentation.
6. Documented outlines describe every executable phase and give every row a unique name.

## Enforcement

`bddConfig()` installs two independent layers with `levelPolicy: "error"` and
`documentationPolicy: "error"`:

- a worker-side setup hook that validates the complete collected test tree;
- `bddContractReporter()` for aggregated collection diagnostics.

A test registered directly through Vitest has no `meta.bdd` and fails the test
run. Replacing reporters from the CLI, including `--reporter=json` or
`--reporter=dot`, does not remove the worker-side gate. Each policy accepts
`off`, `warn`, or `error`, so classification and documentation migrations can
be ratcheted independently.

## Compatibility

Version 3 enables both error policies by default. This is intentionally a major
release: suites upgrading from 2.x must migrate native tests or temporarily set
one or both policies to `warn`.

The legacy outline callback form remains available for migration, but it is
marked as undocumented metadata and fails when `documentationPolicy` is `error`.
Convert each callback to a `[description, callback]` tuple.

The older `policy` and `requirePhaseDescriptions` options remain deprecated
aliases for existing consumers.
