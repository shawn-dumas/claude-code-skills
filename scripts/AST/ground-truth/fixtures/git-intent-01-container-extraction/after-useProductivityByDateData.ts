import { useEffect, useMemo, useRef } from 'react';
import { getProductivityDayStatsQueryParams, getTTMForDaysQueryParams } from '@/shared/utils/insightsQueryParams';
import { useTTMForDaysQuery, useProductivityDayStatsQuery } from '@/services/hooks/queries/insights';
import { composeTtmTableData, mapAuxTableData, mapDaysTableData } from './utils';
import type { Filters } from '@/shared/types/insightsFilters';
import type {
  MappedAUXSummaryData,
  MappedTTMBreakdownData,
  MappedTTMForDaysData,
  MappedUserStats,
} from '@/shared/types/productivity';

/**
 * Owns the query orchestration and data derivation for the
 * productivity-by-date drill-down: TTM-for-days query, day stats query,
 * chart data correction, table data mapping, and auto-select best day.
 */
export function useProductivityByDateData(
  user: MappedUserStats,
  currentDay: MappedTTMForDaysData | null,
  onChangeCurrentDay: (day: MappedTTMForDaysData | null) => void,
  userProductivityFilters: Filters['userProductivity'],
) {
  const days = useMemo(() => user.timePerDay.map(day => day.date), [user.timePerDay]);

  // -- TTM for days query --
  const ttmQueryParams = useMemo(
    () => getTTMForDaysQueryParams(userProductivityFilters, user.uid, days),
    [userProductivityFilters, user.uid, days],
  );
  const {
    data: ttmForDaysData,
    isLoading: isTableLoading,
    isFetching: isTableFetching,
  } = useTTMForDaysQuery(ttmQueryParams, { enabled: !!userProductivityFilters?.teams.length && !!days.length });

  // -- Day stats query (depends on currentDay) --
  const productivityDayStatsQueryParams = useMemo(
    () => getProductivityDayStatsQueryParams(userProductivityFilters, user.uid, currentDay),
    [userProductivityFilters, user.uid, currentDay],
  );
  const {
    data: chartData,
    isLoading: isChartLoading,
    isFetching: isChartFetching,
  } = useProductivityDayStatsQuery(productivityDayStatsQueryParams, {
    enabled: !!currentDay?.date && !!user.uid && !isTableLoading && !isTableFetching,
  });

  const isTableLoadingVisible = isTableLoading || isTableFetching;
  const isChartLoadingVisible = isChartLoading || isChartFetching;

  // -- Days table data --
  const daysTableData = useMemo(
    () => mapDaysTableData(user.timePerDay, ttmForDaysData ?? []) ?? [],
    [user.timePerDay, ttmForDaysData],
  );

  // Auto-select best day on data arrival. This MUST be a useEffect, not render-time
  // source tracking, because onChangeCurrentDay updates state in a parent component
  // (ProductivityBlock). React disallows cross-component state updates during render.
  // The ref guard prevents reruns caused by currentDay updating as a result of this
  // effect, and preserves the original "only on data ref change" semantics.
  const prevDaysTableDataRef = useRef(daysTableData);
  useEffect(() => {
    if (prevDaysTableDataRef.current === daysTableData) return;
    prevDaysTableDataRef.current = daysTableData;

    if (!daysTableData?.length) return;

    const newCurrentDay =
      daysTableData.find(day => day.date === currentDay?.date) ??
      daysTableData.find(day => day.ttm > 0) ??
      daysTableData[0];

    if (newCurrentDay) onChangeCurrentDay(newCurrentDay);
  }, [daysTableData, currentDay?.date, onChangeCurrentDay]);

  // Derive chart data with corrected start/end (API returns wrong values)
  const correctedChartData = useMemo(() => {
    if (!chartData || !currentDay) return chartData ?? null;
    return {
      ...chartData,
      ttm: { ...chartData.ttm, start: currentDay.first, end: currentDay.last },
    };
  }, [chartData, currentDay]);

  // -- TTM breakdown table data --
  const ttmTableData = useMemo<MappedTTMBreakdownData[]>(() => {
    if (!currentDay) return [];
    return composeTtmTableData(user.timePerDay, currentDay, correctedChartData);
  }, [currentDay, user.timePerDay, correctedChartData]);

  // -- AUX summary table data --
  const auxTableData = useMemo<MappedAUXSummaryData[]>(() => {
    if (!correctedChartData?.aux.summary) return [];
    return mapAuxTableData(correctedChartData.aux.summary);
  }, [correctedChartData]);

  return {
    daysTableData,
    isTableLoadingVisible,
    isChartLoadingVisible,
    correctedChartData,
    ttmTableData,
    auxTableData,
  };
}
