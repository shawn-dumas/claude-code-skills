/* eslint-disable */
// Fixture: formatter file with anonymous arrow functions (negative case)
// toFixed and toLocaleString inside a formatter file should be suppressed
// even when the containing function name does not start with 'format'
// (e.g., arrow functions in object literals, callbacks).

const unitFormatter: Record<string, (value: number) => string> = {
  percentage: (value: number) => {
    const rounded = Math.round(value * 100) / 100;
    return rounded.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + '%';
  },
  currency: (value: number) => {
    return '$' + value.toFixed(2);
  },
};

export { unitFormatter };
