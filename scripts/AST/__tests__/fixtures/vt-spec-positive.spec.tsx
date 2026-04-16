/**
 * Positive fixture for ast-vitest-parity.
 * Contains all patterns the tool should detect.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { build, buildMany } from '@/fixtures';

vi.mock('next/router', () => ({
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));

vi.mock('../hooks/useData', () => ({
  useData: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

describe('MyComponent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('rendering', () => {
    it('renders the header', () => {
      const data = build({ name: 'Test' });
      render(<MyComponent data={data} />);
      expect(screen.getByRole('heading')).toBeInTheDocument();
      expect(screen.getByText('Test')).toBeVisible();
    });

    it('renders empty state', () => {
      render(<MyComponent data={null} />, { wrapper: TestProvider });
      expect(screen.getByText('No data')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('handles click', () => {
      const handler = vi.fn();
      render(<MyComponent onClick={handler} />);
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('HelperComponent', () => {
  it('renders items', () => {
    const items = buildMany(3);
    render(<HelperComponent items={items} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
