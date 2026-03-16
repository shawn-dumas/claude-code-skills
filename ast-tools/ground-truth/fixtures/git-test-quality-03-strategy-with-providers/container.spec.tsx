import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Container } from './container';

vi.mock('./useQuery', () => ({
  useItemsQuery: vi.fn(() => ({ data: [], isLoading: false })),
}));

const queryClient = new QueryClient();

function renderWith(ui: React.ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  queryClient.clear();
});

describe('Container', () => {
  it('renders name', () => {
    renderWith(<Container name='Alice' />);
    expect(screen.getByText('Hello Alice')).toBeInTheDocument();
  });
});
