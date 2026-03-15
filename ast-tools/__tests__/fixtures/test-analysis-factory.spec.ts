/**
 * Factory-pattern fixture for ast-test-analysis.
 *
 * Exercises:
 * - test.each with inline array
 * - it.each with variable reference
 * - describe.each (should count describes, not tests)
 * - A factory function wrapping test() with a template literal name
 */

import { describe, it, test, expect } from 'vitest';
import { formatDate } from '../utils/helpers';

// --- Pattern 1: test.each with inline array ---

test.each([
  ['hello', 'Hello'],
  ['world', 'World'],
  ['abc', 'Abc'],
])('capitalizes %s to %s', (input, expected) => {
  expect(input).toBeDefined();
  expect(expected).toBeDefined();
});

// --- Pattern 2: it.each with variable reference ---

const edgeCases = [
  { input: '', expected: '' },
  { input: ' ', expected: ' ' },
  { input: '123', expected: '123' },
  { input: null, expected: '' },
];

describe('edge cases', () => {
  it.each(edgeCases)('handles $input', ({ input, expected }) => {
    expect(input).toBeDefined();
    expect(expected).toBeDefined();
  });
});

// --- Pattern 3: describe.each (should NOT expand test count) ---

describe.each([{ mode: 'light' }, { mode: 'dark' }])('theme $mode', ({ mode }) => {
  it('renders correctly', () => {
    expect(mode).toBeDefined();
  });
});

// --- Pattern 4: Factory function wrapping test() ---

function testFormatter(label: string, input: string, expected: string) {
  test(`formats ${label} correctly`, () => {
    expect(formatDate(input)).toBe(expected);
  });
}

testFormatter('date', '2024-01-01', 'Jan 1, 2024');
testFormatter('empty', '', '');

// --- Pattern 5: A regular test (not expanded) ---

test('standalone test', () => {
  expect(true).toBe(true);
});
