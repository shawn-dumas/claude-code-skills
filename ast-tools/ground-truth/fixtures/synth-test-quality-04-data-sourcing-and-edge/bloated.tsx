import React from 'react';

interface Props {
  value: number;
}

export function BloatedWidget({ value }: Props) {
  return <span>{value}</span>;
}
