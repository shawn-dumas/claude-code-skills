// Real-world fixture derived from ClassificationUrlsContainer.spec.tsx
// and TeamDetailContainer.spec.tsx patterns.
// Contains hook call assertion patterns that assert on internal wiring
// rather than rendered output.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const useClassificationUrlsQuery = vi.fn(() => ({
  data: [],
  isLoading: false,
}));

const useUpdateTeamMutation = vi.fn(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClassificationUrlsContainer', () => {
  it('passes teamId to useClassificationUrlsQuery', () => {
    render('<div>URLs</div>');
    expect(useClassificationUrlsQuery).toHaveBeenCalledWith(expect.objectContaining({ teamId: 42, enabled: true }));
  });

  it('disables query when teamId is undefined', () => {
    render('<div>URLs</div>');
    expect(useClassificationUrlsQuery).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('renders the URL list correctly', () => {
    render('<div>example.com</div>');
    expect(screen.getByText('example.com')).toBeVisible();
  });
});

describe('TeamDetailContainer', () => {
  it('passes isUpdatingTeam when mutation is pending', () => {
    render('<div>Team</div>');
    expect(useUpdateTeamMutation).toHaveBeenCalled();
  });

  it('renders team name', () => {
    render('<div>Engineering</div>');
    expect(screen.getByText('Engineering')).toBeVisible();
  });
});
