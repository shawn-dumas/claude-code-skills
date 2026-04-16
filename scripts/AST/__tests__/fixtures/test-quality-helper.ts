/**
 * Test helper fixture for ast-interpret-test-quality helper resolution.
 *
 * Contains helper functions with classified assertions:
 * - expectUserCard: user-visible assertion (toHaveTextContent)
 * - expectCallbackFired: implementation-detail assertion (toHaveBeenCalled)
 * - expectDataShape: implementation-detail assertion (toBe)
 */

import { expect } from 'vitest';

export function expectUserCard(result: { name: string; email: string }) {
  const el = document.querySelector('.user-card');
  expect(el).toHaveTextContent(result.name);
  expect(el).toHaveTextContent(result.email);
}

export function expectCallbackFired(mockFn: ReturnType<typeof vi.fn>) {
  expect(mockFn).toHaveBeenCalled();
  expect(mockFn).toHaveBeenCalledTimes(1);
}

export function expectDataShape(data: { id: number; name: string }) {
  expect(data.id).toBe(1);
  expect(data.name).toBe('test');
}
