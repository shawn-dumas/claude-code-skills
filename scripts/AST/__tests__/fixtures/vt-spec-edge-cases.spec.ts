/**
 * Fixture for ast-vitest-parity: exercises edge case branches.
 * - NoSubstitutionTemplateLiteral test names (backtick strings without interpolation)
 * - Unnamed describe blocks
 * - Non-string name args (dynamic expressions)
 */
import { describe, it, expect } from 'vitest';

// Unnamed describe (no string literal as first arg)
describe((() => 'unnamed')(), () => {
  it('test inside unnamed describe', () => {
    expect(true).toBe(true);
  });
});

// NoSubstitutionTemplateLiteral: backtick without ${}
describe('edge cases', () => {
  it(`renders without crashing`, () => {
    expect(1 + 1).toBe(2);
  });

  it(`handles empty state`, () => {
    expect([]).toHaveLength(0);
  });
});

// Dynamic name (non-string, non-template)
const name = 'dynamic test';
it(name, () => {
  expect(true).toBe(true);
});
