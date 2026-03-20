/**
 * Simplified version of src/shared/utils/insightsQueryParams/shared.ts.
 * Real file exports formatTeams which has no dedicated spec and no indirect spec coverage.
 */

export function formatTeams(teams: (string | number)[] | undefined): number[] {
  return teams?.map(Number).filter(num => !Number.isNaN(num)) ?? [];
}
