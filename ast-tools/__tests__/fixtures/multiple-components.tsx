import React, { useState, useCallback, useMemo, memo, forwardRef } from 'react';

// Inner helper (non-exported, PascalCase, returns JSX)
function StatusBadge({ status }: { status: string }) {
  return <span className={status}>{status}</span>;
}

// Container-like component (exported, calls hooks)
interface ContainerProps {
  teamId: string;
  onSelect: (id: string) => void;
}

export function Container({ teamId, onSelect }: ContainerProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const handleSelect = useCallback(
    (id: string) => {
      setSelected(id);
      onSelect(id);
    },
    [onSelect],
  );
  const items = useMemo(() => [teamId], [teamId]);

  return (
    <div>
      <ContentBlock items={items} selected={selected} onSelect={handleSelect} />
    </div>
  );
}

// Presentational leaf (exported, pure props)
interface ContentBlockProps {
  items: string[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function ContentBlock({ items, selected, onSelect }: ContentBlockProps) {
  return (
    <ul>
      {items.map(item => (
        <li key={item} onClick={() => onSelect(item)}>
          {item}
          <StatusBadge status={selected === item ? 'active' : 'inactive'} />
        </li>
      ))}
    </ul>
  );
}

// Memo-wrapped component
interface MemoCardProps {
  title: string;
  value: number;
}

export const MemoCard = memo(function MemoCard({ title, value }: MemoCardProps) {
  return (
    <div>
      <h3>{title}</h3>
      <span>{value}</span>
    </div>
  );
});

// forwardRef component
interface InputFieldProps {
  label: string;
  onChange: (value: string) => void;
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(function InputField({ label, onChange }, ref) {
  return (
    <label>
      {label}
      <input ref={ref} onChange={e => onChange(e.target.value)} />
    </label>
  );
});

// Custom hook defined in this file
export function useLocalFilter(items: string[]) {
  const [filter, setFilter] = useState('');
  const filtered = useMemo(() => items.filter(i => i.includes(filter)), [items, filter]);
  return { filter, setFilter, filtered };
}
