import { describe, it, expect } from 'vitest';

describe('useTeamData', () => {
  it('returns team members', () => {
    expect(result.current.members).toHaveLength(3);
    expect(result.current.members[0].name).toBe('Alice');
    expect(result.current.members[0].role).toBe('engineer');
  });

  it('handles loading state', () => {
    expect(result.current.isLoading).toBe(true);
  });

  it('handles error state', () => {
    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toBe('Network error');
  });
});
