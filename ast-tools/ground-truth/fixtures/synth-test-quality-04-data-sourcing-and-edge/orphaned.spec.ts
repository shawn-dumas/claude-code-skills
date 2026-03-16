import { describe, it, expect } from 'vitest';
import { calculateTotal } from './deleted-module';

describe('calculateTotal', () => {
  it('sums values', () => {
    expect(calculateTotal([1, 2, 3])).toBe(6);
  });
});
