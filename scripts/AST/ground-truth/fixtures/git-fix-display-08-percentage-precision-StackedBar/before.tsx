import React from 'react';
import { StackedBar } from '@/shared/ui';

interface FlowData {
  percentage: number;
  total: number;
}

export function StackedBarBreakdown({ data }: { data: FlowData }) {
  const percentageLabel = `(${data.percentage.toFixed(1)}%)`;

  return <StackedBar total={data.total} label={percentageLabel} />;
}
