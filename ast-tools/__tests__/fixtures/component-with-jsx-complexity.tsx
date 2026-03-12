import React from 'react';

interface Item {
  id: string;
  name: string;
  status: 'active' | 'inactive' | 'pending';
  score: number;
  isVisible: boolean;
  isEnabled: boolean;
  isSelected: boolean;
}

interface ListProps {
  items: Item[];
  isAdmin: boolean;
  isLoading: boolean;
  isCompact: boolean;
  onSelect: (id: string) => void;
}

export function ComplexList({ items, isAdmin, isLoading, isCompact, onSelect }: ListProps) {
  return (
    <div>
      {/* CHAINED_TERNARY: nested ternary */}
      {isLoading ? (
        <span>Loading...</span>
      ) : items.length === 0 ? (
        <span>No items</span>
      ) : isAdmin ? (
        <span>Admin view</span>
      ) : (
        <span>User view</span>
      )}

      {/* INLINE_TRANSFORM: .filter().map() chain */}
      {items
        .filter(item => item.status === 'active')
        .map(item => (
          <div key={item.id}>{item.name}</div>
        ))}

      {/* Simple .map() -- NOT a violation */}
      {items.map(item => (
        <div key={item.id}>{item.name}</div>
      ))}

      {/* COMPLEX_GUARD: 3+ conditions */}
      {isAdmin && isLoading && isCompact && <span>All three conditions</span>}

      {/* Simple guard -- NOT a violation */}
      {isAdmin && <span>Admin only</span>}
      {isAdmin && isLoading && <span>Two conditions</span>}

      {/* IIFE_IN_JSX */}
      {(() => {
        const total = items.reduce((sum, i) => sum + i.score, 0);
        return <span>Total: {total}</span>;
      })()}

      {/* MULTI_STMT_HANDLER */}
      <button
        onClick={e => {
          e.preventDefault();
          const first = items[0];
          if (first) {
            console.log('selecting', first.id);
            onSelect(first.id);
          }
        }}
      >
        Select First
      </button>

      {/* Single-statement handler -- NOT a violation */}
      <button onClick={() => onSelect('test')}>Simple Click</button>

      {/* INLINE_STYLE_OBJECT with computed value */}
      <div style={{ width: `${items.length * 10}px`, color: 'red' }}>Styled inline</div>

      {/* Static style -- NOT a violation (no computed values) */}

      {/* COMPLEX_CLASSNAME: chained ternary in className */}
      <div className={isAdmin ? (isCompact ? 'admin-compact' : 'admin-full') : isLoading ? 'loading' : 'default'}>
        Complex class
      </div>
    </div>
  );
}
