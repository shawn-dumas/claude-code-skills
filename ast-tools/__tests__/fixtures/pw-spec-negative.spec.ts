/**
 * Negative fixture for ast-test-parity.
 * Contains patterns that should NOT produce Playwright-specific observations.
 * This is a Vitest unit test, not a Playwright spec.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./some-module');

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<div>Hello</div>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('handles click', () => {
    const fn = vi.fn();
    expect(fn).toHaveBeenCalled();
  });
});
