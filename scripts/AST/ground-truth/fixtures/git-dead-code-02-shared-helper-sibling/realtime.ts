/**
 * Stripped from src/shared/utils/insightsQueryParams/realtime.ts
 * Imports formatTimezone from sibling shared.ts.
 */
import { formatTimezone } from './shared';

export function getRealtimeStatsQueryParams(filters: { team?: string; timezone?: number } | null) {
  return {
    teams: filters?.team ? [Number(filters.team)] : [],
    timezone: formatTimezone(filters?.timezone),
  };
}
