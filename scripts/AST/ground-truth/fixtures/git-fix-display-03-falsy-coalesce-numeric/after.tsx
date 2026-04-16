import { formatDuration, formatNumber } from '@/shared/utils';
import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { ColumnSize } from '@/components/8flow/Table';
import { MicroworkflowData, MicroWorkflowsByUser } from '@/shared/types/microworkflows';
import { microworkflowsByUserTableAccessors } from './constants';
import { ProgressBar } from '@/shared/ui';
import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';

const columnHelper = createColumnHelper<MicroWorkflowsByUser>();

function buildCountColumn(
  key: 'occurrencesCount' | 'workstreamsCount',
  header: string,
  selectedMicroworkflow: MicroworkflowData | undefined,
) {
  return columnHelper.accessor(row => row[key], {
    header,
    cell: ({ getValue }) => {
      if (!selectedMicroworkflow) return <ProgressBar label='0' progress={0} size='sm' />;

      const value = getValue();
      const total =
        key === 'occurrencesCount' ? selectedMicroworkflow.occurrencesCount : selectedMicroworkflow.workstreamsCount;
      const percentage = (value / (total || 1)) * 100;

      return <ProgressBar label={formatNumber(value)} progress={percentage} size='sm' />;
    },
    minSize: ColumnSize.XS,
  });
}

function buildDurationColumn(key: 'avgTimeSpentPerWs' | 'avgDuration' | 'totalDuration', header: string) {
  return columnHelper.accessor(row => row[key] ?? undefined, {
    header,
    cell: ({ getValue }) => formatDuration(getValue()),
    minSize: ColumnSize.XS,
  });
}

function buildDefaultColumn(key: keyof MicroWorkflowsByUser, header: string) {
  return columnHelper.accessor(row => row[key] || undefined, {
    header,
    cell: ({ getValue }) => {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string should display '-' fallback
      const value = String(getValue() || NO_VALUE_PLACEHOLDER);
      return <div title={value}>{value}</div>;
    },
    minSize: ColumnSize.SM,
  });
}

const DURATION_KEYS = new Set(['avgTimeSpentPerWs', 'avgDuration', 'totalDuration']);
const COUNT_KEYS = new Set(['occurrencesCount', 'workstreamsCount']);

export function useMicroworkflowsByUserTableColumns(selectedMicroworkflow: MicroworkflowData | undefined) {
  const columns = useMemo(
    () =>
      microworkflowsByUserTableAccessors.map(({ key, header }) => {
        if (COUNT_KEYS.has(key))
          return buildCountColumn(key as 'occurrencesCount' | 'workstreamsCount', header, selectedMicroworkflow);
        if (DURATION_KEYS.has(key))
          return buildDurationColumn(key as 'avgTimeSpentPerWs' | 'avgDuration' | 'totalDuration', header);
        return buildDefaultColumn(key, header);
      }),
    [selectedMicroworkflow],
  );

  return columns;
}
