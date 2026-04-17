import { MetricItemShape } from '@/shared/ui/MetricsDisplay';

interface SampleData {
  avgResponseTime: number;
}

export const responseMetrics: MetricItemShape<SampleData>[] = [
  {
    label: 'Avg Response Time',
    getValue: data => data.avgResponseTime.toFixed(2),
  },
];
