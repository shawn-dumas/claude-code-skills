import React from 'react';
import { StackedBar } from '@/shared/ui';
import { formatNumber } from '@/shared/utils';

interface FlowData {
  percentage: number;
  total: number;
}

export function StackedBarBreakdown({ data }: { data: FlowData }) {
  const percentageLabel = `(${formatNumber(data.percentage, 0)}%)`;

  return <StackedBar total={data.total} label={percentageLabel} />;
}
