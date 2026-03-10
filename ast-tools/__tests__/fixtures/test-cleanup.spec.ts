import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { processData } from './data-processor';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('processData', () => {
  it('processes data with timers', () => {
    const result = processData([1, 2, 3]);
    vi.advanceTimersByTime(1000);
    expect(result).toEqual([2, 4, 6]);
  });

  it('stores result in localStorage', () => {
    processData([1]);
    expect(localStorage.getItem('result')).toBe('[2]');
  });
});
