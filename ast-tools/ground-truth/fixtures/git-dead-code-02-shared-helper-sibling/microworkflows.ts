/**
 * Stripped from src/shared/utils/insightsQueryParams/microworkflows.ts
 * Imports formatTeams from sibling shared.ts.
 */
import { formatTeams } from './shared';

export function getMicroworkflowsQueryParams(filters: { teams?: (string | number)[] } | null) {
  return {
    teams: formatTeams(filters?.teams),
  };
}
