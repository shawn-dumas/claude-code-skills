/* eslint-disable */
import React, { useState, useMemo, useCallback } from 'react';

interface EntityConfig {
  useGetAllQuery: () => { data: unknown[]; isLoading: boolean };
  useCreateMutation: (opts?: unknown) => { mutateAsync: (v: unknown) => Promise<void>; isPending: boolean };
  entityName: string;
}

interface Props {
  config: EntityConfig;
}

export function SettingsEntityContainer({ config }: Props) {
  const { useGetAllQuery, useCreateMutation, entityName } = config;
  const [searchValue, setSearchValue] = useState('');

  const { data: entities, isLoading } = useGetAllQuery();

  const filtered = useMemo(() => {
    if (!entities) return [];
    return searchValue ? entities.filter(Boolean) : entities;
  }, [entities, searchValue]);

  const { mutateAsync: create, isPending } = useCreateMutation();

  const handleCreate = useCallback((name: string) => void create({ name }).catch(() => undefined), [create]);

  return (
    <div>
      <input value={searchValue} onChange={e => setSearchValue(e.target.value)} />
      {isLoading ? <span>Loading...</span> : <ul>{filtered.map(String)}</ul>}
      <button onClick={() => handleCreate('new')} disabled={isPending}>
        {entityName}
      </button>
    </div>
  );
}
