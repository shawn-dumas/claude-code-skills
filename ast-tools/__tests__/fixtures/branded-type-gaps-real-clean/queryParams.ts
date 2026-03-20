/**
 * Real-world fixture (simplified): Functions using branded types correctly.
 * Based on src/shared/utils/insightsQueryParams/systems.ts
 *
 * Expected: no UNBRANDED_PARAM observations.
 */

type UserId = string & { readonly __brand: 'UserId' };
type TeamId = number & { readonly __brand: 'TeamId' };

interface Filters {
  teams: number[];
  timezone: string;
}

interface QueryParams {
  teams: TeamId[];
  userId: UserId;
  timezone: string;
}

const TeamIdBrand = (raw: number) => raw as TeamId;

export function buildQueryParams(filters: Filters, userId: UserId): QueryParams {
  return {
    teams: filters.teams.map(TeamIdBrand),
    userId,
    timezone: filters.timezone,
  };
}

export function getUserOccurrencesParams(filters: Filters, userId: UserId): QueryParams & { pageId: string } {
  return {
    ...buildQueryParams(filters, userId),
    pageId: 'some-page',
  };
}
