import { MetricItemShape } from '@/shared/ui/MetricsDisplay';
import { formatNumber } from '@/shared/utils';

interface SampleData {
  avgResponseTime: number;
}

export const responseMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Avg Response Time',
    getValue: data => formatNumber(data.avgResponseTime, 2),
  },
];
