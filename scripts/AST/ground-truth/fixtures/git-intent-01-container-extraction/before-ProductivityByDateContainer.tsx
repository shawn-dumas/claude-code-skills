import { ProductivityChart } from '@/components/8flow/charts/ProductivityChart';
import { Table } from '@/components/8flow/Table';
import type { Filters } from '@/shared/types/insightsFilters';
import type {
  MappedAUXSummaryData,
  MappedTTMBreakdownData,
  MappedTTMForDaysData,
  MappedUserStats,
} from '@/shared/types/productivity';
import React, { useEffect, useMemo, useRef } from 'react';
import { totalActiveTimeTableAccessors } from './constants';
import { getProductivityDayStatsQueryParams, getTTMForDaysQueryParams } from '@/shared/utils/insightsQueryParams';
import { useTTMForDaysQuery, useProductivityDayStatsQuery } from '@/services/hooks/queries/insights';
import { Loader } from '@/shared/ui';
import { mapTimeUnitAccessors } from '@/shared/utils';
import { TTMBreakdownTable } from './TTMBreakdownTable';
import { AUXSummaryTable } from './AUXSummaryTable';
import { useTTMForDaysTableColumns } from './useTTMForDaysTableColumns';
import { composeTtmTableData, mapAuxTableData, mapDaysTableData } from './utils';
import { CSV_FILENAME_PREFIX } from '../constants';

interface Props {
  user: MappedUserStats;
  currentDay: MappedTTMForDaysData | null;
  onChangeCurrentDay: (day: MappedTTMForDaysData | null) => void;
  isHours: boolean;
  userProductivityFilters: Filters['userProductivity'];
}

export function ProductivityByDateContainer({
  user,
  currentDay,
  onChangeCurrentDay,
  isHours,
  userProductivityFilters,
}: Props) {
  const days = useMemo(() => user.timePerDay.map(day => day.date), [user.timePerDay]);

  const ttmQueryParams = useMemo(
    () => getTTMForDaysQueryParams(userProductivityFilters, user.uid, days),
    [userProductivityFilters, user.uid, days],
  );
  const {
    data: ttmForDaysData,
    isLoading: isTableLoading,
    isFetching: isTableFetching,
  } = useTTMForDaysQuery(ttmQueryParams, { enabled: !!userProductivityFilters?.teams.length && !!days.length });

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

  const isTableLoadingVisible = useMemo(() => isTableLoading || isTableFetching, [isTableLoading, isTableFetching]);
  const isChartLoadingVisible = useMemo(() => isChartLoading || isChartFetching, [isChartLoading, isChartFetching]);

  const mappedAccessors = useMemo(() => mapTimeUnitAccessors(totalActiveTimeTableAccessors, isHours), [isHours]);
  const columns = useTTMForDaysTableColumns(mappedAccessors, isHours);

  const daysTableData = useMemo(
    () => mapDaysTableData(user.timePerDay, ttmForDaysData ?? []) ?? [],
    [user.timePerDay, ttmForDaysData],
  );

  // Auto-select best day on data arrival. This MUST be a useEffect, not render-time
  // source tracking, because onChangeCurrentDay updates state in a parent component
  // (ProductivityBlock). React disallows cross-component state updates during render.
  // See: react.dev/learn/you-might-not-need-an-effect
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

  const ttmTableData = useMemo<MappedTTMBreakdownData[]>(() => {
    if (!currentDay) return [];
    return composeTtmTableData(user.timePerDay, currentDay, correctedChartData);
  }, [currentDay, user.timePerDay, correctedChartData]);

  const auxTableData = useMemo<MappedAUXSummaryData[]>(() => {
    if (!correctedChartData?.aux.summary) return [];
    return mapAuxTableData(correctedChartData.aux.summary);
  }, [correctedChartData]);

  const chartContent =
    isTableLoadingVisible || isChartLoadingVisible ? (
      <div className='relative flex items-center justify-center w-full h-[200px]'>
        <Loader />
      </div>
    ) : correctedChartData ? (
      <ProductivityChart chartData={correctedChartData} />
    ) : (
      <div className='flex items-center justify-center w-full h-full'>No data available</div>
    );

  return (
    <div className='flex flex-col w-full gap-3'>
      <div className='h-[200px] w-full'>{chartContent}</div>

      <div className='flex w-full gap-3 overflow-x-auto justify-stretch'>
        <div className='basis-1/2'>
          {isTableLoadingVisible ? (
            <div className='relative flex items-center justify-center w-full h-[150px]'>
              <Loader />
            </div>
          ) : (
            <Table
              enablePosthog
              disableColsSelect
              disableFilter
              name='Total Active Time'
              columns={columns}
              data={daysTableData}
              clickableRow
              onClickRow={value => onChangeCurrentDay(value)}
              accessors={mappedAccessors}
              highlightedRows={[{ columnKey: 'date', value: currentDay?.date }]}
              headerProps={{
                title: '',
                csvFilename: `${CSV_FILENAME_PREFIX}-Total_Active_Time_${user.uid}`,
                filterPosition: 'right',
                isHours,
              }}
            />
          )}
        </div>

        <div className={correctedChartData?.aux.events.length ? 'basis-1/4' : 'basis-1/2'}>
          <TTMBreakdownTable
            data={ttmTableData}
            loading={isChartLoadingVisible || isTableLoadingVisible}
            isHours={isHours}
          />
        </div>
        {!!correctedChartData?.aux.events.length && (
          <div className='basis-1/4'>
            <AUXSummaryTable
              data={auxTableData}
              loading={isChartLoadingVisible || isTableLoadingVisible}
              isHours={isHours}
            />
          </div>
        )}
      </div>
    </div>
  );
}
