/* eslint-disable @typescript-eslint/no-unused-vars, no-console */

// Fixture for ast-error-flow: catch block error sink classification

// 1. Console sink
function handleWithConsole() {
  try {
    doSomething();
  } catch (err) {
    console.error('Failed:', err);
  }
}

// 2. New Relic sink (wrapper function)
function handleWithNr() {
  try {
    doSomething();
  } catch (err) {
    reportErrorToNewRelic(err);
  }
}

// 3. Rethrow
function handleWithRethrow() {
  try {
    doSomething();
  } catch (err) {
    throw err;
  }
}

// 4. Swallowed (empty catch)
function handleSwallowed() {
  try {
    doSomething();
  } catch {
    // intentionally empty
  }
}

// 5. Response sink (BFF handler pattern)
function handleWithResponse() {
  try {
    doSomething();
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// 6. Callback sink
function handleWithCallback() {
  try {
    doSomething();
  } catch (err) {
    onError(err);
  }
}

// 7. Multiple sinks (console + response)
function handleWithMultiple() {
  try {
    doSomething();
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Failed' });
  }
}

// 8. NREUM.noticeError (direct NREUM call)
function handleWithNreumDirect() {
  try {
    doSomething();
  } catch (err) {
    window.NREUM.noticeError(err);
  }
}

// 9. Swallowed with only variable assignment (no sink)
function handleSwallowedWithAssignment() {
  try {
    doSomething();
  } catch (err) {
    const x = 1;
  }
}

// Helpers to make TypeScript happy
declare function doSomething(): void;
declare function reportErrorToNewRelic(err: unknown): void;
declare const res: { status(code: number): { json(body: unknown): void } };
declare function onError(err: unknown): void;
