/**
 * Stripped from src/shared/utils/insightsQueryParams/shared.ts
 * Exports formatTimezone and formatTeams.
 * Consumed by sibling modules (realtime.ts, productivity.ts, etc.).
 * NOT re-exported by index.ts barrel.
 */
const MINUTES_IN_HOUR = 60;

export function formatTimezone(timezone: number | undefined) {
  return (timezone ?? 0) * MINUTES_IN_HOUR;
}

export function formatTeams(teams: (string | number)[] | undefined) {
  return teams?.map(Number).filter(num => !Number.isNaN(num)) ?? [];
}
