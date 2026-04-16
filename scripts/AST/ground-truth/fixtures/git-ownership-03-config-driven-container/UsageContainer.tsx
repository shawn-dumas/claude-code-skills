/* eslint-disable */
import React, { useMemo } from 'react';
import { useQueryStates } from 'nuqs';

interface UsageConfig<T extends object> {
  useKpiQuery: (params: unknown, opts: unknown) => { data: unknown; isLoading: boolean };
  useDetailQuery: (params: unknown, opts: unknown) => { data: T[]; isLoading: boolean };
}

interface Props<T extends object> {
  config: UsageConfig<T>;
}

export const UsageContainer = <T extends object>({ config }: Props<T>) => {
  const { useKpiQuery, useDetailQuery } = config;

  const [urlFilters] = useQueryStates({
    teams: { defaultValue: [] as string[] },
    tz: { defaultValue: 0 },
  });

  const enabled = (urlFilters.teams as string[]).length > 0;

  const { data: kpiData, isLoading: kpiLoading } = useKpiQuery(urlFilters, { enabled });
  const { data: detailData, isLoading: detailLoading } = useDetailQuery(urlFilters, { enabled });

  return (
    <div>
      {kpiLoading && <span>Loading KPI...</span>}
      {detailLoading && <span>Loading details...</span>}
      <pre>{JSON.stringify({ kpiData, detailData })}</pre>
    </div>
  );
};
