/* eslint-disable */
/**
 * Fixture for TIMER_NEGATIVE_ASSERTION observation.
 *
 * Contains both positive (setTimeout before negative assertion) and
 * negative (setTimeout for legitimate delay, no negative assertion)
 * patterns to verify detection accuracy.
 */
import { describe, it, expect, vi } from 'vitest';

declare const fetchMock: {
  (): void;
  mock: { calls: unknown[][] };
  not: { toHaveBeenCalled: () => void };
};

declare function setup(): void;
declare function render(component: unknown): void;

// --- POSITIVE: setTimeout before not.toHaveBeenCalled (should be flagged) ---
describe('timer negative assertion', () => {
  it('waits then asserts not called', async () => {
    setup();
    await new Promise(r => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits 100ms then asserts not called with', async () => {
    setup();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/api/test'), expect.any(Object));
  });

  // --- NEGATIVE: setTimeout without negative assertion (should NOT be flagged) ---
  it('waits then asserts positively', async () => {
    setup();
    await new Promise(r => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalled();
  });

  // --- NEGATIVE: no setTimeout, just synchronous negative assertion (should NOT be flagged) ---
  it('synchronously asserts not called', () => {
    setup();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // --- NEGATIVE: negative assertion BEFORE timer, not after (should NOT be flagged) ---
  it('asserts not called then waits for something else', async () => {
    setup();
    expect(fetchMock).not.toHaveBeenCalled();
    await new Promise(r => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
