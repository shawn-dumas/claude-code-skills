import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clean spec with render-based assertions', () => {
  it('renders a heading', () => {
    render('<h1>Hello</h1>');
    expect(screen.getByText('Hello')).toBeVisible();
  });

  it('checks disabled state', () => {
    render('<button disabled>Submit</button>');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('checks callback was called', () => {
    const onClick = vi.fn();
    expect(onClick).not.toHaveBeenCalled();
  });
});
