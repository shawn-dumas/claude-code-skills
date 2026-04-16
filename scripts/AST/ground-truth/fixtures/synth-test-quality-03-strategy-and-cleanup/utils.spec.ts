import { describe, it, expect } from 'vitest';
import { formatValue, sum } from './utils';

describe('formatValue', () => {
  it('formats number as dollar amount', () => {
    expect(formatValue(10)).toBe('$10.00');
  });

  it('handles zero', () => {
    expect(formatValue(0)).toBe('$0.00');
  });
});

describe('sum', () => {
  it('sums array of numbers', () => {
    expect(sum([1, 2, 3])).toBe(6);
  });
});
