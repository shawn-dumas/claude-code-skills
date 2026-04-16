import React from 'react';

interface Props {
  name: string;
}

export function Widget({ name }: Props) {
  return <div>Hello {name}</div>;
}
