import { describe, it, expect } from 'vitest';
import { validateEmail } from '../tested-b';

describe('validateEmail', () => {
  it('returns false for empty string', () => {
    expect(validateEmail('')).toBe(false);
  });

  it('returns true for valid email', () => {
    expect(validateEmail('test@example.com')).toBe(true);
  });

  it('returns false for missing @', () => {
    expect(validateEmail('testexample.com')).toBe(false);
  });
});
