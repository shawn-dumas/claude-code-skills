/* eslint-disable */
import React, { useMemo } from 'react';

interface Props {
  status: 'active' | 'inactive' | 'pending';
  label: string;
}

export function StatusBadge({ status, label }: Props) {
  const color = useMemo(() => {
    if (status === 'active') return 'green';
    if (status === 'inactive') return 'red';
    return 'yellow';
  }, [status]);

  return <span style={{ color }}>{label}</span>;
}
