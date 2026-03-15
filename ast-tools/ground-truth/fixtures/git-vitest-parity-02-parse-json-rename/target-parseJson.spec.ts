import { describe, it, expect } from 'vitest';

describe('tryParseJson', () => {
  describe('valid JSON strings', () => {
    it.each([['{"key":"value"}', { key: 'value' }]])('returns ok:true for valid JSON: %s', (input, expected) => {
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(expected);
    });
  });
  describe('invalid JSON strings', () => {
    it.each([['not json']])('returns ok:false with error for invalid JSON: %s', () => {
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
    });
  });
  describe('type preservation', () => {
    it('preserves all JSON types without coercion', () => {
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ string: 'text', number: 123 });
      expect(typeof result.value.string).toBe('string');
    });
    it('preserves nested objects', () => {
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ nested: { a: 1 } });
    });
  });
  describe('special JSON cases', () => {
    it('handles JSON with special characters in keys', () => {
      expect(result.value).toEqual({ 'key-dash': 'v1', 'key.dot': 'v2' });
    });
    it('handles large JSON strings', () => {
      expect(Object.keys(result.value)).toHaveLength(100);
    });
  });
  describe('schema validation', () => {
    it('returns ok:true when schema matches', () => {
      expect(result.ok).toBe(true);
      expect(result.value).toEqual({ name: 'Alice', age: 30 });
    });
  });
});
