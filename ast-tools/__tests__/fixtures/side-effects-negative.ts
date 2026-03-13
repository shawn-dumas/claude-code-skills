/* eslint-disable */
// Negative fixture file for ast-side-effects tests.
// Documents edge cases and false-positive scenarios.

// 1. Variable named 'console' (shadow)
// Decision: current tools match on property access pattern.
// An observation-only tool reports it; the skill/interpreter decides.
// This is a structural fact about the code, not a judgment.
const console = { log: (msg: string) => msg };
console.log('shadowed console'); // Should still match on property access pattern

// 2. Toast-like function that is NOT the toast library
// Decision: the observation reports the call site. The evidence
// includes the identifier name. The skill can check if it imports
// from a toast library.
function toast(msg: string) {
  return msg;
}
toast('local toast function'); // Should be detected as TOAST_CALL

// 3. setTimeout in a test helper (not production code)
// This fixture IS a production file from the tool's perspective,
// so it should be detected. The observation includes containingFunction,
// which lets consumers filter by context.
function testHelper() {
  setTimeout(() => {}, 100);
}

// 4. window.location.href read (not assignment)
// Should NOT be WINDOW_MUTATION. Only assignments to location are mutations.
const url = window.location.href;
const pathname = window.location.pathname;

// 5. history.length read (not mutation)
// Should NOT be detected as WINDOW_MUTATION
const historyLength = history.length;

// 6. console object property access (not a call)
// Should NOT be detected
const logMethod = console.log;

// 7. posthog property access (not a method call)
// Should NOT be detected
const captureMethod = posthog.capture;

// 8. Timer-like variable names (not actual timer calls)
// Should NOT be detected
const setTimeout = 'not a function';
const myTimeout = 123;
