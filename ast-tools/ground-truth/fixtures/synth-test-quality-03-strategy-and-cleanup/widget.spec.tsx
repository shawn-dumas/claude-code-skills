import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { Widget } from './widget';

afterEach(() => {
  // empty afterEach with no recognized cleanup pattern
});

function renderWithProvider(name: string) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <Widget name={name} />
    </QueryClientProvider>,
  );
}

describe('Widget', () => {
  it('renders greeting', () => {
    renderWithProvider('Alice');
    expect(screen.getByText('Hello Alice')).toBeInTheDocument();
  });
});
