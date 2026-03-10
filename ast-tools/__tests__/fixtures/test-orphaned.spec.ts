import { describe, it, expect } from 'vitest';
import { transform } from './nonexistent-module';

describe('OrphanedTest', () => {
  it('tests a function that no longer exists', () => {
    expect(transform('input')).toBe('output');
  });
});
