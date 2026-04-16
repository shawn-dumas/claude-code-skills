/* eslint-disable */
// Fixture for template literal resolution in query key factories.

// 1. Query key factory with a template literal value
const DOMAIN = 'analytics';

export const analyticsQueryKeys = {
  all: () => [DOMAIN] as const,
  byTeam: (teamId: string) => [`${DOMAIN}-team-${teamId}`] as const,
  detail: (id: string) => [DOMAIN, 'detail', id] as const,
} as const;

// 2. Query key factory using plain arrays only (control case)
export const projectsQueryKeys = {
  all: () => ['projects'] as const,
  list: (filter?: string) => ['projects', 'list', filter] as const,
} as const;
