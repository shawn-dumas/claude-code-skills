/* eslint-disable */
// Trimmed from: src/ui/page_blocks/dashboard/usage/constants.ts
// Preserves real patterns: !value truthy guard conflating 0 with null,
// hardcoded '-' without NO_VALUE_PLACEHOLDER import, formatDuration call.

declare function formatInt(v: number): string;
declare function formatDuration(v: number | undefined, opts?: unknown): string;

type SystemAggregateKPIs = {
  activeUsers?: number;
  totalTimeSaved?: number;
  totalUsage?: number;
};

type MetricItemShape = {
  label: string;
  getValue: (data: SystemAggregateKPIs | undefined) => string;
};

export const usageKpiItems: MetricItemShape[] = [
  {
    label: 'Unique Users',
    getValue: data => (data?.activeUsers ? formatInt(data.activeUsers) : '-'),
  },
  {
    label: 'Time Saved',
    getValue: data => formatDuration(data?.totalTimeSaved, { precision: 'minutes' }),
  },
  {
    label: 'Total Usage',
    getValue: data => (data?.totalUsage ? formatInt(data.totalUsage) : '-'),
  },
];
