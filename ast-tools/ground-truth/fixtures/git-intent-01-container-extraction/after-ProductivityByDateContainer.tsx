import { ProductivityChart } from '@/components/8flow/charts/ProductivityChart';
import { Table } from '@/components/8flow/Table';
import type { Filters } from '@/shared/types/insightsFilters';
import type { MappedTTMForDaysData, MappedUserStats } from '@/shared/types/productivity';
import React, { useMemo } from 'react';
import { totalActiveTimeTableAccessors } from './constants';
import { Loader } from '@/shared/ui';
import { mapTimeUnitAccessors } from '@/shared/utils';
import { TTMBreakdownTable } from './TTMBreakdownTable';
import { AUXSummaryTable } from './AUXSummaryTable';
import { useTTMForDaysTableColumns } from './useTTMForDaysTableColumns';
import { CSV_FILENAME_PREFIX } from '../constants';
import { useProductivityByDateData } from './useProductivityByDateData';

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
  const {
    daysTableData,
    isTableLoadingVisible,
    isChartLoadingVisible,
    correctedChartData,
    ttmTableData,
    auxTableData,
  } = useProductivityByDateData(user, currentDay, onChangeCurrentDay, userProductivityFilters);

  const mappedAccessors = useMemo(() => mapTimeUnitAccessors(totalActiveTimeTableAccessors, isHours), [isHours]);
  const columns = useTTMForDaysTableColumns(mappedAccessors, isHours);

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
