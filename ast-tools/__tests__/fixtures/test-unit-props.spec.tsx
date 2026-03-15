import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MyComponent } from '../components/MyComponent';

vi.mock('next/router', () => ({
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));

vi.mock('echarts-for-react', () => ({
  default: () => <div>chart</div>,
}));

describe('MyComponent', () => {
  it('renders the title', () => {
    const onSubmit = vi.fn();
    render(<MyComponent title='Hello' onSubmit={onSubmit} />);
    expect(screen.getByText('Hello')).toBeVisible();
  });

  it('fires callback on submit', () => {
    const onSubmit = vi.fn();
    render(<MyComponent title='Hello' onSubmit={onSubmit} />);
    expect(onSubmit).toHaveBeenCalledWith('submitted');
  });

  it('renders the role', () => {
    render(<MyComponent title='Test' onSubmit={vi.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
