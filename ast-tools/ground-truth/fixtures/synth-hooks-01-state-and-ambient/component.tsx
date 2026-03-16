/* eslint-disable */
import React, { useState, useMemo, useCallback, useRef } from 'react';
import { useBreakpoints } from '@/shared/hooks/useBreakpoints';
import { usePagination } from '@/shared/hooks/usePagination';
import { useClickAway } from '@/shared/hooks/useClickAway';

interface Props {
  items: string[];
}

export function StateAndAmbientPanel({ items }: Props) {
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filtered = useMemo(() => items.filter(i => i.includes(search)), [items, search]);
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value), []);
  const { isMobile } = useBreakpoints();
  const { page, pageSize } = usePagination({ totalItems: filtered.length });
  useClickAway(containerRef, () => setSearch(''));

  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <div ref={containerRef}>
      <input value={search} onChange={handleChange} />
      {isMobile ? <span>Mobile</span> : null}
      {visible.map(v => (
        <span key={v}>{v}</span>
      ))}
    </div>
  );
}
