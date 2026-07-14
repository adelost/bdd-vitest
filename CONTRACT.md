# bdd-vitest contract

The contract exists so tests remain executable documentation rather than only
executable code.

## Required invariants

1. Every test has exactly one level: `unit`, `component`, `integration`, or `e2e`.
2. Every scenario and phase description is non-empty.
3. Every test has a `then` phase. This guarantees an explicit outcome phase;
   the assertion library itself is intentionally not prescribed.
4. Cleanup runs after the scenario even when a phase fails.
5. Every registered test carries JSON-serializable `meta.bdd` documentation.
6. Documented outlines describe Given, When, and Then and give every row a name.

## Enforcement

`bddConfig()` installs `bddContractReporter()` with `policy: "error"`. A test
registered directly through Vitest has no `meta.bdd` and fails the test run.
Use `policy: "warn"` only as a migration ratchet; `off` is intended for tooling
that merely consumes the preset defaults.

## Compatibility

The legacy outline callback form remains executable in 2.x, but it is marked as
undocumented metadata and fails when `requirePhaseDescriptions` is enabled.
Convert each callback to a `[description, callback]` tuple.
