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
  describe('type preservation', () => {
    it('preserves all JSON types without coercion', () => {
      expect(result).toEqual({ string: 'text', number: 123 });
      expect(typeof result.string).toBe('string');
      expect(typeof result.number).toBe('number');
    });
    it('preserves nested objects', () => {
      expect(result).toEqual({ nested: { a: 1 } });
      expect(typeof result.nested).toBe('object');
    });
  });
  describe('special JSON cases', () => {
    it('handles JSON with special characters in keys', () => {
      expect(result).toEqual({ 'key-dash': 'v1', 'key.dot': 'v2' });
    });
    it('handles large JSON strings', () => {
      expect(Object.keys(result)).toHaveLength(100);
      expect(result.key0).toBe('value0');
    });
  });
});
