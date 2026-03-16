/**
 * Fixture for testing .each() extraction in ast-vitest-parity.
 * Covers it.each, test.each, and describe.each patterns.
 */
import { describe, it, expect } from 'vitest';

describe('parseJson', () => {
  describe('valid JSON strings', () => {
    it.each([['{"key":"value"}', { key: 'value' }]])('parses valid JSON: %s', (input, expected) => {
      expect(parseJson(input)).toEqual(expected);
    });
  });

  describe('invalid JSON strings', () => {
    it.each([['not json', null]])('returns null for invalid JSON: %s', (input, expected) => {
      expect(parseJson(input)).toEqual(expected);
    });
  });

  it('handles a normal test case', () => {
    expect(true).toBe(true);
  });
});

describe.each([
  ['number', 42],
  ['string', 'hello'],
])('type: %s', typeName => {
  it('round-trips through serialize', () => {
    expect(serialize(typeName)).toBeDefined();
  });
});
