import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { urlsTableAccessors } from './constants';
import { formatDuration } from '@/shared/utils';
import { prettyPrintCategory } from './utils';
import { MappedClassificationUrlItem } from '@/shared/types/url-classification';
import { ColumnSize } from '@/components/8flow/Table';
import { SECOND_MS } from '@/types';
import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';

const columnHelper = createColumnHelper<MappedClassificationUrlItem>();

export function useUrlsTableColumns() {
  const columns = useMemo(
    () =>
      urlsTableAccessors.map(({ key, header }) => {
        if (key === 'host') {
          return columnHelper.accessor(row => row[key], {
            header,
            cell: ({ getValue, row }) => {
              const categoryIsDifferentOnTeamLevel = row.original?.teamData?.find(
                ({ category }) => category !== row.original.category,
              );

              return (
                <div className='relative flex font-medium text-slate-800'>
                  {categoryIsDifferentOnTeamLevel && <div className='relative text-red-500 bottom-1'>*</div>}
                  <span title={getValue()} className='truncate'>
                    {getValue()}
                  </span>
                </div>
              );
            },
            minSize: ColumnSize.LG,
          });
        }

        if (key === 'totalDuration') {
          return columnHelper.accessor(row => row[key], {
            header,
            cell: ({ getValue }) => formatDuration(getValue() / SECOND_MS),
          });
        }

        if (key === 'category') {
          return columnHelper.accessor(row => row[key], {
            header,
            cell: ({ getValue }) => prettyPrintCategory(getValue()),
          });
        }

        return columnHelper.accessor(row => row[key], {
          header,
          cell: cell => cell.getValue() ?? NO_VALUE_PLACEHOLDER,
        });
      }),
    [],
  );

  return columns;
}
