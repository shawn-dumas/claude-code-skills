/* eslint-disable */
// Fixture: constant definition file (negative case)
// The file that DEFINES NO_VALUE_PLACEHOLDER should not be flagged
// for HARDCODED_PLACEHOLDER -- it IS the canonical source.

export const NO_VALUE_PLACEHOLDER = '-';

// This usage should also be suppressed since the file defines the constant
function example(value: string | null) {
  return value ?? NO_VALUE_PLACEHOLDER;
}

export { example };
