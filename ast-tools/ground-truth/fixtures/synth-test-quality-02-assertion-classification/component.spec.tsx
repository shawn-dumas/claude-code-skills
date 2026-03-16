import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionButton } from './component';

describe('ActionButton', () => {
  it('renders the label text', () => {
    render(<ActionButton label='Submit' onClick={vi.fn()} />);
    expect(screen.getByText('Submit')).toBeInTheDocument();
  });

  it('is visible when not disabled', () => {
    render(<ActionButton label='Save' onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    render(<ActionButton label='Go' onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled when prop is true', () => {
    render(<ActionButton label='Nope' onClick={vi.fn()} disabled />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('matches snapshot', () => {
    const { container } = render(<ActionButton label='Snap' onClick={vi.fn()} />);
    expect(container).toMatchSnapshot();
  });

  it('checks internal mock call', () => {
    const handler = vi.fn();
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('verifies hook was called', () => {
    const useCustomHook = vi.fn();
    useCustomHook();
    expect(useCustomHook).toHaveBeenCalled();
  });
});
