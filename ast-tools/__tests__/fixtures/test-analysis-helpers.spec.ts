/**
 * Helper delegation fixture for ast-test-analysis.
 *
 * Exercises:
 * - A test calling an imported helper function (relative path)
 * - A test calling a local helper function
 * - A test calling a Vitest global (should NOT be tracked as helper)
 * - A test calling a standard library function (should NOT be tracked)
 */

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error -- fixture file, module doesn't exist
import { buildUser, verifyUserFields } from '../test-helpers/userHelpers';

// Local helper function defined in the test file
function assertValidResponse(response: { status: number; body: unknown }) {
  expect(response.status).toBe(200);
  expect(response.body).toBeDefined();
}

describe('helper delegation tracking', () => {
  it('calls an imported helper', () => {
    const user = buildUser({ name: 'test' });
    verifyUserFields(user);
    expect(user.name).toBe('test');
  });

  it('calls a local helper', () => {
    const response = { status: 200, body: { ok: true } };
    assertValidResponse(response);
  });

  it('calls only Vitest globals (no helper delegation)', () => {
    const spy = vi.fn();
    spy('test');
    expect(spy).toHaveBeenCalledWith('test');
  });

  it('calls standard library functions (no helper delegation)', () => {
    const data = JSON.stringify({ key: 'value' });
    const parsed = JSON.parse(data);
    expect(parsed.key).toBe('value');
  });
});
