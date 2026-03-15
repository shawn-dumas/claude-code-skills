import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

vi.mock('@/services/hooks/queries/useUserData');

describe('UserCard', () => {
  it('renders user card', () => {
    render(<UserCard user={mockUser} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('alice@test.com')).toBeInTheDocument();
    expect(screen.getByRole('img')).toHaveAttribute('alt', 'Alice');
    expect(screen.getByTestId('user-card')).toBeVisible();
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

  it('shows error message', () => {
    render(<UserCard user={mockUser} error='Failed' />);
    expect(screen.getByText('Failed')).toBeVisible();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders empty state', () => {
    render(<UserCard user={null} />);
    expect(screen.getByText('No user selected')).toBeVisible();
    expect(screen.queryByTestId('user-card')).not.toBeInTheDocument();
  });
});
