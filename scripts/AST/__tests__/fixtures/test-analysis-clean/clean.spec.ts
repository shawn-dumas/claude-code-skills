import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('lodash');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clean spec', () => {
  it('has proper cleanup and no violations', () => {
    expect(1 + 1).toBe(2);
  });

  it('uses only third-party mocks', () => {
    expect(true).toBe(true);
  });
});
