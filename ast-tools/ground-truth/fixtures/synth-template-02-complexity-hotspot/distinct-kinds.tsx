import React from 'react';

interface Item {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
}

interface Props {
  items: Item[];
  showInactive: boolean;
  onSelect: (id: string) => void;
}

export function ItemList({ items, showInactive, onSelect }: Props) {
  return (
    <div className='item-list'>
      {showInactive && <p className='inactive-notice'>Showing inactive items</p>}
      {items
        .filter(i => i.active || showInactive)
        .map(item => (
          <div key={item.id} className='item-row'>
            <span>{item.name}</span>
            <span>{item.active ? 'Active' : 'Inactive'}</span>
            <ul>
              {item.tags.map(tag => (
                <li key={tag}>{tag}</li>
              ))}
            </ul>
            <button type='button' onClick={() => onSelect(item.id)}>
              Select
            </button>
          </div>
        ))}
    </div>
  );
}
