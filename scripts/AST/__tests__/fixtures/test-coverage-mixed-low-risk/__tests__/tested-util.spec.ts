import { describe, it, expect } from 'vitest';
import { capitalize } from '../tested-util';

describe('capitalize', () => {
  it('capitalizes first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('returns empty for empty string', () => {
    expect(capitalize('')).toBe('');
  });
});
