import React from 'react';

interface Props {
  items: string[];
}

export function ItemList({ items }: Props) {
  return (
    <ul>
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
