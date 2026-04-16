import { MetricItemShape } from '@/shared/ui/MetricsDisplay';

interface SampleData {
  totalUsers: number;
}

export const userMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => data.totalUsers.toLocaleString(),
  },
];
