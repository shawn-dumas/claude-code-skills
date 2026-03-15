import { z } from 'zod';
import { describe, it, expect } from 'vitest';

describe('validateDateRange', () => {
  it('passes when dateRange is undefined', () => {
    expect(result.success).toBe(true);
  });
  it('passes when dateRange is empty', () => {
    expect(result.success).toBe(true);
  });
  it('passes when only start date is provided', () => {
    expect(result.success).toBe(true);
  });
  it('passes when date diff is within the limit', () => {
    expect(result.success).toBe(true);
  });
  it('passes when date diff is exactly one less than the limit', () => {
    expect(result.success).toBe(true);
  });
  it('fails when date diff equals the limit', () => {
    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['dateRange'], message: 'Max 30 days' }),
    ]));
  });
  it('fails when date diff exceeds the limit', () => {
    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['dateRange'], message: 'Max 7 days' }),
    ]));
  });
  it('works with different dayLimits values', () => {
    expect(result.success).toBe(false);
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['dateRange'], message: 'Max 90 days' }),
    ]));
  });
});
