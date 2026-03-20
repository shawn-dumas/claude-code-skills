/* eslint-disable */
// Fixture: number formatting patterns (negative cases)
// These should NOT produce RAW_TO_FIXED, RAW_TO_LOCALE_STRING, etc.
// Suppression rule: containing function name starts with 'format' (case-sensitive prefix).
// This covers canonical formatters and any domain-specific format helpers.

// Math.round used for array index computation (not display)
function computeIndex(length: number, fraction: number) {
  return Math.round(length * fraction);
}

// toFixed used inside a formatting function definition (name starts with 'format' -> suppressed)
function formatPercentage(value: number): string {
  return `${value.toFixed(2)}%`;
}

// toLocaleString inside a formatting utility (name starts with 'format' -> suppressed)
function formatCurrency(value: number): string {
  return value.toLocaleString("en-US");
}

// Math.floor for non-display computation
function paginate(total: number, pageSize: number) {
  return Math.floor(total / pageSize);
}

export { computeIndex, formatPercentage, formatCurrency, paginate };
