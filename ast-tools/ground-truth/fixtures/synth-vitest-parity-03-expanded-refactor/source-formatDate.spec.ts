import { describe, it, expect } from 'vitest';

describe('formatDate', () => {
  it('formats date string', () => {
    expect(formatDate('2024-01-15')).toBe('Jan 15, 2024');
    expect(formatDate('2024-12-31')).toBe('Dec 31, 2024');
  });

  it('handles null input', () => {
    expect(formatDate(null)).toBe('--');
  });
});
