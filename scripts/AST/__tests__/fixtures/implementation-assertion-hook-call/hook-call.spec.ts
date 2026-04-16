import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useRouter = vi.fn(() => ({ push: vi.fn() }));
const useTeamsListQuery = vi.fn(() => ({ data: [], isLoading: false }));
const mockUseFeatureFlags = vi.fn(() => ({ featureFlags: {} }));

vi.mock('next/router', () => ({
  useRouter,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('spec with hook call assertions', () => {
  it('asserts useRouter was called (implementation detail)', () => {
    render('<div>Test</div>');
    expect(useRouter).toHaveBeenCalled();
  });

  it('asserts useTeamsListQuery was called with args (implementation detail)', () => {
    render('<div>Teams</div>');
    expect(useTeamsListQuery).toHaveBeenCalledWith(42);
  });

  it('asserts mockUseFeatureFlags was called (prefixed mock pattern)', () => {
    render('<div>Flags</div>');
    expect(mockUseFeatureFlags).toHaveBeenCalledWith();
  });

  it('asserts on rendered output (not an implementation assertion)', () => {
    render('<div>Visible</div>');
    expect(screen.getByText('Visible')).toBeVisible();
  });
});
