import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusPanel } from './component';

vi.mock('next/router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(),
}));

vi.mock('./useLocalState', () => ({
  useLocalState: vi.fn(() => ({ count: 5, setCount: vi.fn() })),
}));

vi.mock('../domain-b/useRemoteData', () => ({
  useRemoteData: vi.fn(() => ({ data: [], setData: vi.fn() })),
}));

vi.mock('../domain-b/useExternalConfig', () => ({
  useExternalConfig: vi.fn(() => ({ config: {}, setConfig: vi.fn() })),
}));

describe('StatusPanel', () => {
  it('renders title', () => {
    render(<StatusPanel title='Status' count={10} />);
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
