/**
 * Negative fixture for ast-vitest-parity.
 * Minimal structure: no describes, no mocks, bare assertions.
 */

import { it, expect } from 'vitest';

it('adds two numbers', () => {
  expect(1 + 1).toBe(2);
});

it('string concat', () => {
  expect('a' + 'b').toBe('ab');
});
