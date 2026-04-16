import { describe, it, expect, vi } from 'vitest';

// Mock of own hook (should be flagged as OWN_HOOK)
vi.mock('../hooks/useData', () => ({
  useData: vi.fn().mockReturnValue({ data: [], isLoading: false }),
}));

// Mock of boundary (legitimate)
vi.mock('next/router', () => ({
  useRouter: vi.fn().mockReturnValue({ push: vi.fn() }),
}));

describe('SomeComponent', () => {
  it('renders correctly', () => {
    // as any in mock data (should be flagged)
    const mockData = { id: 1, name: 'test' } as any;
    expect(mockData.name).toBe('test');
  });

  it('handles click', () => {
    const handler = vi.fn();
    handler('test');
    expect(handler).toHaveBeenCalledWith('test');
  });
});
