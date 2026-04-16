import { describe, it, expect, vi } from 'vitest';
import { sharedData } from '../__tests__/constants';

// MOCK_INTERNAL: mocks a project-internal module
vi.mock('@/shared/utils/date/formatDate', () => ({
  formatDate: vi.fn(),
}));

// No afterEach -- triggers MISSING_CLEANUP

describe('violations spec', () => {
  it('uses as-any cast', () => {
    const data = {} as any;
    expect(data).toBeDefined();
  });

  it('uses shared mutable constants', () => {
    expect(sharedData).toBeDefined();
  });
});
