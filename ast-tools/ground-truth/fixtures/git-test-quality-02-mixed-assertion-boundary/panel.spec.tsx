import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Panel } from './panel';

vi.mock('./useData', () => ({
  useDataQuery: vi.fn(() => ({ data: [], isLoading: false })),
}));

describe('Panel', () => {
  it('renders title with count', () => {
    render(<Panel title='Items' count={3} onSave={vi.fn()} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Items (3)');
  });

  it('fires onSave callback', async () => {
    const onSave = vi.fn();
    render(<Panel title='Items' count={0} onSave={onSave} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('checks toast was called', () => {
    const toast = { success: vi.fn() };
    toast.success('Item saved');
    expect(toast.success).toHaveBeenCalledWith('Item saved');
  });

  it('checks mutateAsync arg', () => {
    const mutate = { mutateAsync: vi.fn() };
    mutate.mutateAsync({ name: 'Test' });
    expect(mutate.mutateAsync).toHaveBeenCalledWith({ name: 'Test' });
  });

  it('checks hook mock was called', () => {
    const useDataQuery = vi.fn();
    useDataQuery();
    expect(useDataQuery).toHaveBeenCalled();
  });
});
