import React from 'react';

interface Props {
  items: string[];
  title: string;
}

export function SimpleList({ items, title }: Props) {
  return (
    <div className='simple-list'>
      <h2>{title}</h2>
      <ul>
        {items.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
