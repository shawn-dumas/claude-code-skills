import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { LargeComponent } from '../components/LargeComponent';
import { useCounter } from '../hooks/useCounter';

vi.mock('../hooks/useData', () => ({
  useData: vi.fn(),
}));

describe('LargeComponent', () => {
  it('matches snapshot', () => {
    const { container } = render(<LargeComponent a='1' b='2' c='3' d='4' e='5' f='6' />);
    expect(container).toMatchSnapshot();
  });
});

describe('useCounter', () => {
  it('returns the initial count', () => {
    const { result } = renderHook(() => useCounter(0));
    expect(result.current.count).toBe(0);
  });

  it('increments the count', () => {
    const { result } = renderHook(() => useCounter(5));
    expect(result.current.count).toBe(5);
    expect(result.current.increment).toBeDefined();
  });
});
