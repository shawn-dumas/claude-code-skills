import { describe, it, expect } from 'vitest';
import { formatDate, parseNumber } from '../utils/helpers';

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2024-01-01')).toBe('Jan 1, 2024');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDate('')).toBe('');
  });
});

describe('parseNumber', () => {
  it('parses integer strings', () => {
    expect(parseNumber('42')).toBe(42);
  });

  it('returns NaN for non-numeric strings', () => {
    expect(Number.isNaN(parseNumber('abc'))).toBe(true);
  });
});
