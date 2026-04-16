import { HeaderGroup, flexRender } from '@tanstack/react-table';
import React from 'react';
import { ColumnArrowDown, ColumnArrowUp } from '../Icons';
import { AppPosthogEvent, sendPosthogEvent } from '@/shared/lib/posthog';
import { tableTestIds } from './constants';

export function SortIcon({ sortOrder }: { sortOrder: 'asc' | 'desc' | false }) {
  if (!sortOrder) return null;

  return sortOrder === 'desc' ? <ColumnArrowDown /> : <ColumnArrowUp />;
}

interface TableHeadProps<Data> {
  headerGroups: HeaderGroup<Data>[];
  enablePosthog?: boolean;
  tableName: string;
}

export const TableHead = <Data extends object>({ headerGroups, enablePosthog, tableName }: TableHeadProps<Data>) =>
  headerGroups.map(group => (
    <tr key={group.id} data-testid={tableTestIds.headRow}>
      {group.headers.map(header => {
        const sort = header.column.getIsSorted();

        const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
          const handler = header.column.getToggleSortingHandler();

          if (handler) {
            handler(e);

            const previousSortOrder = sort ? sort : 'none';

            if (enablePosthog) {
              sendPosthogEvent({
                eventName: AppPosthogEvent.TABLE_COLUMN_SORTED,
                properties: {
                  column_name: header.column.columnDef.header,
                  table_name: tableName,
                  previous_sort_order: previousSortOrder,
                  sort_order: previousSortOrder === 'none' ? 'desc' : previousSortOrder === 'desc' ? 'asc' : 'none',
                },
              });
            }
          }
        };

        return (
          <th
            key={header.id}
            data-testid={tableTestIds.headCell}
            className='border-slate-200 whitespace-nowrap first:pl-2 last:pr-2'
          >
            <button
              data-testid={tableTestIds.headSortBtn}
              className='flex items-center px-3 justify-center py-1.5 font-semibold text-left'
              type='button'
              onClick={header.column.getCanSort() ? handleClick : undefined}
              aria-sort={sort === 'asc' ? 'ascending' : sort === 'desc' ? 'descending' : 'none'}
              style={{ cursor: header.column.getCanSort() ? 'pointer' : 'default' }}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}

              <div className='ml-[8px] w-2 h-1.5'>
                <SortIcon sortOrder={sort} />
              </div>
            </button>
          </th>
        );
      })}
    </tr>
  ));
