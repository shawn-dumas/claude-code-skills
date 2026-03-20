import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn().mockResolvedValue(undefined);
const mutate = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('spec with mutation call assertions', () => {
  it('asserts mutateAsync was called with args (implementation detail)', async () => {
    render('<button>Save</button>');
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ name: 'New Team' });
    });
  });

  it('asserts mutate was called (implementation detail)', () => {
    render('<button>Delete</button>');
    expect(mutate).toHaveBeenCalled();
  });

  it('asserts mutateAsync was called once (implementation detail)', async () => {
    render('<button>Update</button>');
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('asserts on rendered output (not an implementation assertion)', () => {
    render('<div>Saved!</div>');
    expect(screen.getByText('Saved!')).toBeVisible();
  });
});
