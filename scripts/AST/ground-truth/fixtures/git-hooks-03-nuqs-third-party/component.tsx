/* eslint-disable */
// Extracted from: src/ui/page_blocks/dashboard/operational-hours/TeamProductivityContainer.tsx
import { useMemo } from 'react';
import { useQueryStates } from 'nuqs';
import { getOperationalAnalysisQueryParams } from '@/shared/utils/insightsQueryParams';
import { useOperationalAnalysisQuery } from '@/services/hooks/queries/insights';
import { urlParams } from '@/shared/url-params';
import type { Filters } from '@/shared/types/insightsFilters';

export function TeamProductivityContainer() {
  const [urlFilters] = useQueryStates({
    teams: urlParams.teams,
    reportPeriod: urlParams.reportPeriod,
    tz: urlParams.tz,
    startTime: urlParams.startTime,
    endTime: urlParams.endTime,
  });

  const filters: Filters['teamProductivity'] = useMemo(() => {
    if (!urlFilters.teams?.length) return null;
    return { teams: urlFilters.teams, timezone: urlFilters.tz ?? 0 };
  }, [urlFilters]);

  const enabled = !!filters?.teams.length;
  const queryParams = useMemo(() => getOperationalAnalysisQueryParams(filters), [filters]);
  const { data, isLoading, isFetching } = useOperationalAnalysisQuery(queryParams, { enabled });

  return <div>{JSON.stringify({ data, isLoading: isLoading || isFetching })}</div>;
}
