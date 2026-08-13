// Clock-step injection, loaded with --import so it wraps Date.now BEFORE the
// Vitest runner captures it (@vitest/runner reads `const now = Date.now` at
// module scope).
//
// Models a real host: ours stepped its wall clock +3584ms roughly twice a
// minute while `performance.now` and libuv timers stayed monotonic. That is
// exactly the split this level machinery relies on, so injecting the step is
// how we prove the reliance is real rather than asserted.
//
// The flag must stay set THROUGH the test's settle: Vitest judges its timeout
// retroactively, after the body returns, so a probe that clears the flag early
// reads an unstepped clock and proves nothing.
const realNow = Date.now;
Date.now = function now() {
  return realNow() + (globalThis.__stepClock ? 4000 : 0);
};
