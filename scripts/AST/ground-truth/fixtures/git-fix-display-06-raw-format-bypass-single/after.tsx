import { MetricItemShape } from '@/shared/ui/MetricsDisplay';
import { formatInt } from '@/shared/utils';

interface SampleData {
  totalUsers: number;
}

export const userMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Total Users',
    getValue: data => formatInt(data.totalUsers),
  },
];
