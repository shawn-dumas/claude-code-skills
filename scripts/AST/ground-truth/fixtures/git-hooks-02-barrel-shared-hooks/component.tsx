/* eslint-disable */
// Extracted from: src/ui/page_blocks/dashboard/systems/SystemsContainer.tsx
import { useEffect, useMemo } from 'react';
import { useLayout } from '@/providers/context/layout';
import { FeatureFlagsToLoad, useFeatureFlagPageGuard } from '@/shared/hooks';
import { useSystemsUrlState } from './useSystemsUrlState';
import { useSystemsQueries } from './useSystemsQueries';

export function SystemsContainer() {
  useFeatureFlagPageGuard(FeatureFlagsToLoad.ENABLE_SYSTEMS);
  const { systemsFilters, sys, handleSelectSystem } = useSystemsUrlState();
  const { systemsOverviewData, isSystemsFetching } = useSystemsQueries(systemsFilters, sys, null, null);
  const { setHeaderMetricsProps } = useLayout();

  useEffect(() => {
    if (systemsOverviewData?.totals || isSystemsFetching) {
      setHeaderMetricsProps({ data: systemsOverviewData?.totals, isLoading: isSystemsFetching });
    }
    return () => setHeaderMetricsProps(null);
  }, [systemsOverviewData?.totals, isSystemsFetching, setHeaderMetricsProps]);

  const pageState = useMemo(
    () => ({ selectedSystem: null, update: { selectedSystem: handleSelectSystem } }),
    [handleSelectSystem],
  );

  return <div>{JSON.stringify(pageState)}</div>;
}
