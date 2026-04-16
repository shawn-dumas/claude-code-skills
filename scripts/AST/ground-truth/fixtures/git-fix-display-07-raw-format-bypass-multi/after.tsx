import { MetricItemShape } from '@/shared/ui/MetricsDisplay';
import { formatInt } from '@/shared/utils';

interface SampleData {
  totalUsers: number;
  revenue: number;
  growth: number;
  activeUsers: number;
}

export const sampleMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => formatInt(data.totalUsers),
  },
  {
    label: 'Revenue',
    getValue: data => `$${formatInt(data.revenue)}`,
  },
];

export const metricsWithSecondary: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => formatInt(data.totalUsers),
    getSecondaryValue: data => `${data.activeUsers} active`,
  },
  {
    label: 'Revenue',
    getValue: data => `$${formatInt(data.revenue)}`,
    getSecondaryValue: data => `+${data.growth}%`,
  },
];
