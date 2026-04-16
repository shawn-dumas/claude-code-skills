/**
 * Test fixture for ast-interpret-test-quality helper resolution.
 *
 * Imports and calls helper functions from test-quality-helper.ts.
 * The interpreter should resolve the helper and attribute assertions
 * from the helper to this test.
 */

import { describe, it, expect, vi } from 'vitest';
import { renderUserCard } from './test-quality-subject';
import { expectUserCard, expectCallbackFired } from './test-quality-helper';

describe('renderUserCard', () => {
  it('renders user card correctly', () => {
    const result = renderUserCard('Alice', 'alice@example.com');
    expectUserCard(result);
  });

  it('fires callback on click', () => {
    const mockFn = vi.fn();
    mockFn();
    expectCallbackFired(mockFn);
  });

  it('has inline assertions too', () => {
    expect(true).toBe(true);
  });
});
