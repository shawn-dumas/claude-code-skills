import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MyContainer } from '../containers/MyContainer';

vi.mock('../../services/hooks/useData', () => ({
  useData: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

const queryClient = new QueryClient();

function renderWithProviders(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MyContainer', () => {
  it('renders data', () => {
    vi.useFakeTimers();
    renderWithProviders(<MyContainer />);
    expect(screen.getByText('Data loaded')).toBeVisible();
  });

  it('shows loading state', () => {
    renderWithProviders(<MyContainer />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
