// Real-world fixture derived from AddTeamFormContainer.spec.tsx
// and EditURLsFormContainer.spec.tsx patterns.
// Contains mutation call assertion patterns from container specs.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mutateAsync = vi.fn().mockResolvedValue(undefined);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AddTeamFormContainer', () => {
  it('calls createTeam with the team name on submit', async () => {
    render('<button>Add Team</button>');
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ name: 'New Team' });
    });
  });

  it('renders the form correctly', () => {
    render('<input placeholder="Team name" />');
    expect(screen.getByText('Team name')).toBeVisible();
  });
});

describe('EditURLsFormContainer', () => {
  it('calls updateUrl with the new classification', async () => {
    render('<button>Save</button>');
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 1,
        classification: 'productive',
        url: 'example.com',
      });
    });
  });

  it('calls mutateAsync for batch update', async () => {
    render('<button>Update All</button>');
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalled();
    });
  });

  it('renders save confirmation', () => {
    render('<div>Changes saved</div>');
    expect(screen.getByText('Changes saved')).toBeVisible();
  });
});
