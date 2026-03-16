import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './card';

describe('Card', () => {
  it('renders title via heading query', () => {
    render(<Card title='Total' total={5} />);
    expect(screen.getByRole('heading')).toHaveTextContent('Total');
  });

  it('checks heading textContent directly', () => {
    render(<Card title='Score' total={10} />);
    expect(screen.getByRole('heading').textContent).toBe('Score ');
  });

  it('renders total value', () => {
    render(<Card title='Sum' total={42} />);
    expect(screen.getByText('42')).toBeVisible();
  });

  it('does not throw when total is zero', () => {
    expect(() => render(<Card title='Empty' total={0} />)).not.toThrow();
  });

  it('checks length of rendered items', () => {
    render(<Card title='X' total={3} />);
    const headings = screen.getAllByRole('heading');
    expect(headings).toHaveLength(1);
  });
});
