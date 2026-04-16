import React from 'react';

interface Props {
  title: string;
  count: number;
  items: string[];
}

export function CleanCard({ title, count, items }: Props) {
  return (
    <div className='card'>
      <h3>{title}</h3>
      <p>Total: {count}</p>
      <ul>
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
