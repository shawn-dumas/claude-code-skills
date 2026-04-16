import React from 'react';

interface Props {
  title: string;
  count: number;
}

export function StatusPanel({ title, count }: Props) {
  return (
    <div>
      <h2>{title}</h2>
      <span>{count}</span>
    </div>
  );
}
