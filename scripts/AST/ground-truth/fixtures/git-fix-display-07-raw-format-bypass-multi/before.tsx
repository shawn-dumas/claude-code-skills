import { MetricItemShape } from '@/shared/ui/MetricsDisplay';

interface SampleData {
  totalUsers: number;
  revenue: number;
  growth: number;
  activeUsers: number;
}

export const sampleMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => data.totalUsers.toLocaleString(),
  },
  {
    label: 'Revenue',
    getValue: data => `$${data.revenue.toLocaleString()}`,
  },
];

export const metricsWithSecondary: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => data.totalUsers.toLocaleString(),
    getSecondaryValue: data => `${data.activeUsers} active`,
  },
  {
    label: 'Revenue',
    getValue: data => `$${data.revenue.toLocaleString()}`,
    getSecondaryValue: data => `+${data.growth}%`,
  },
];
