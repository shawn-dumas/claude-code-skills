/* eslint-disable */
// Fixture: ZERO_CONFLATION patterns where the then-statement is a Block (braces),
// and the else-branch proves numeric context.

declare function formatDuration(v: number): string;

// ZERO_CONFLATION -- !value guard where the then-statement is a block containing return
// This exercises the `else if (Node.isBlock(thenStmt))` branch (lines 373-375)
function blockGuardWithNumericReturn(value: number | null) {
  if (!value) {
    return '0.00';
  }
  return String(value);
}

// ZERO_CONFLATION -- !value guard where the ELSE branch proves numeric context
// (calls a format function), exercising lines 404-415
function ifGuardWithNumericElse(value: number | null) {
  if (!value) {
    return '-';
  } else {
    return formatDuration(value);
  }
}

export { blockGuardWithNumericReturn, ifGuardWithNumericElse };
