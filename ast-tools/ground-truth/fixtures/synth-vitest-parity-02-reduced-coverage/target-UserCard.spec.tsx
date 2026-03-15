import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

vi.mock('@/services/hooks/queries/useUserData');

describe('UserCard', () => {
  it('renders user card', () => {
    render(<UserCard user={mockUser} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@test.com')).toBeInTheDocument();
  });

  it('handles click', async () => {
    const onClick = vi.fn();
    render(<UserCard user={mockUser} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows loading', () => {
    render(<UserCard user={mockUser} isLoading={true} />);
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
  });
});
