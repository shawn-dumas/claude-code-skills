import { describe, it, expect } from 'vitest';

describe('formatDate', () => {
  it('formats ISO date', () => {
    expect(formatDate('2024-01-15')).toBe('Jan 15, 2024');
    expect(formatDate('2024-12-31')).toBe('Dec 31, 2024');
    expect(formatDate('2024-06-15T10:30:00Z')).toBe('Jun 15, 2024');
  });

  it('formats relative date', () => {
    expect(formatRelativeDate(yesterday)).toBe('Yesterday');
    expect(formatRelativeDate(lastWeek)).toBe('7 days ago');
  });

  it('handles null and undefined input', () => {
    expect(formatDate(null)).toBe('--');
    expect(formatDate(undefined)).toBe('--');
    expect(formatDate('')).toBe('--');
  });

  it('formats date with timezone', () => {
    expect(formatDate('2024-01-15', 'US/Pacific')).toBe('Jan 14, 2024');
    expect(formatDate('2024-01-15', 'Europe/London')).toBe('Jan 15, 2024');
  });
});
