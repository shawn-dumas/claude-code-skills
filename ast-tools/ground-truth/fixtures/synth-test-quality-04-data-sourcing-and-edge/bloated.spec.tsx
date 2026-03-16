import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BloatedWidget } from './bloated';

vi.mock('./useHelperA', () => ({
  useHelperA: vi.fn(() => [0, vi.fn()]),
}));

vi.mock('./useHelperB', () => ({
  useHelperB: vi.fn(() => ['', vi.fn()]),
}));

vi.mock('./useHelperC', () => ({
  useHelperC: vi.fn(() => [false, vi.fn()]),
}));

describe('BloatedWidget', () => {
  it('renders value', () => {
    render(<BloatedWidget value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
