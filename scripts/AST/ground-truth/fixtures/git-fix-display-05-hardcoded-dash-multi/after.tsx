import { MappedRealtimeStats, RealtimeStatus, RealtimeStatusLabels } from '@/shared/types/realtime';
import { ColumnDef, createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { operationalStatusTableAccessors } from './constants';
import { formatDuration, upperCaseToNormal, DateFormat, formatDate } from '@/shared/utils';
import { ColumnSize } from '@/components/8flow/Table';
import { formatRealtimeEvent } from './utils';
import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';

const columnHelper = createColumnHelper<MappedRealtimeStats>();

/** Strip offset/Z suffix so formatDate treats the value as wall-clock time. */
const toWallClock = (iso: string) => iso.replace(/[+-]\d{2}:\d{2}$/, '').replace(/Z$/, '');

type ColumnKey = keyof MappedRealtimeStats;

const statusColors: Record<RealtimeStatus, string> = {
  active: 'bg-[#059669]',
  lunch: 'bg-[#EAB308]',
  break: 'bg-[#EAB308]',
  offline: 'bg-[#EAB308]',
  locked: 'bg-[#E11D48]',
  idle: 'bg-[#E11D48]',
  unknown: 'bg-[#E11D48]',
};

const columnBuilders: Partial<Record<ColumnKey, (header: string) => ColumnDef<MappedRealtimeStats, unknown>>> = {
  email: header =>
    columnHelper.accessor(row => row.email, {
      header,
      cell: ({ getValue }) => <div title={getValue()}>{getValue()}</div>,
      sortingFn: 'alphanumeric',
      minSize: ColumnSize.MD,
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  displayName: header =>
    columnHelper.accessor(row => row.displayName, {
      header,
      cell: ({ getValue }) => <div title={getValue()}>{getValue()}</div>,
      sortingFn: 'alphanumeric',
      minSize: ColumnSize.MD,
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  firstEventTime: header =>
    columnHelper.accessor(row => row.firstEventTime, {
      header,
      cell: ({ getValue }) => (getValue() ? formatDate(toWallClock(getValue()!), DateFormat.H_MM_A) : NO_VALUE_PLACEHOLDER),
      minSize: ColumnSize.XS,
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  lastEventTime: header =>
    columnHelper.accessor(row => row.lastEventTime, {
      header,
      cell: ({ getValue }) => (getValue() ? formatDate(toWallClock(getValue()!), DateFormat.H_MM_A) : NO_VALUE_PLACEHOLDER),
      minSize: ColumnSize.XS,
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  lastEvent: header =>
    columnHelper.accessor(row => row.lastEvent, {
      header,
      cell: ({ getValue }) => {
        const value = getValue();
        if (!value) return NO_VALUE_PLACEHOLDER;
        const [prefix, host] = formatRealtimeEvent(value);
        return (
          <div className='flex items-center gap-1'>
            <b>{prefix}</b>
            <p className='truncate max-w-[18dvw]'>{host}</p>
          </div>
        );
      },
      minSize: ColumnSize.SM,
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  status: header =>
    columnHelper.accessor(row => row.status ?? undefined, {
      header,
      cell: ({ getValue }) => {
        const status = getValue();
        return (
          <div className='flex items-center gap-2'>
            <div className={`h-2 w-2 rounded-full ${status ? statusColors[status] : 'bg-gray-300'}`} />
            <span>{status ? RealtimeStatusLabels[status] : NO_VALUE_PLACEHOLDER}</span>
          </div>
        );
      },
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  statusDuration: header =>
    columnHelper.accessor(row => row.statusDuration ?? undefined, {
      header,
      cell: ({ getValue }) => {
        const value = getValue();
        return value != null ? formatDuration(value) : NO_VALUE_PLACEHOLDER;
      },
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  auxStatus: header =>
    columnHelper.accessor(row => row.auxStatus ?? undefined, {
      header,
      cell: ({ getValue }) => {
        const value = getValue();
        return value ? upperCaseToNormal(value) : NO_VALUE_PLACEHOLDER;
      },
    }) as ColumnDef<MappedRealtimeStats, unknown>,

  auxDuration: header =>
    columnHelper.accessor(row => row.auxDuration ?? undefined, {
      header,
      cell: ({ getValue }) => {
        const value = getValue();
        return value != null ? formatDuration(value) : NO_VALUE_PLACEHOLDER;
      },
    }) as ColumnDef<MappedRealtimeStats, unknown>,
};

export function useOperationalStatusTableColumns() {
  const columns = useMemo(
    () =>
      operationalStatusTableAccessors.map(({ key, header }) => {
        const builder = columnBuilders[key];
        if (builder) return builder(header);

        return columnHelper.accessor(row => row[key], {
          header,
          cell: cell => cell.getValue() ?? NO_VALUE_PLACEHOLDER,
        }) as ColumnDef<MappedRealtimeStats, unknown>;
      }),
    [],
  );

  return columns;
}
