import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectWidget } from './widget';

vi.mock('./hooks', () => ({
  useDropdownScrollHandler: () => ({ current: null }),
}));

vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

describe('SelectWidget', () => {
  it('renders label', () => {
    render(<SelectWidget label='Choose' onSelect={vi.fn()} />);
    expect(screen.getByText('Choose')).toBeInTheDocument();
  });

  it('fires onSelect callback', async () => {
    const onSelect = vi.fn();
    render(<SelectWidget label='Pick' onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
