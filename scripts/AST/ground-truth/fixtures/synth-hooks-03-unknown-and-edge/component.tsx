/* eslint-disable */
import React, { useState } from 'react';
import { useCustomAnalytics } from '@/utils/analytics';
import { useDebounce } from 'some-third-party-lib';
import { useRouter } from 'next/router';
import { useFilterScope } from '@/page_blocks/dashboard/context/filterScope';

interface Props {
  query: string;
}

export function EdgeCasePanel({ query }: Props) {
  const [value, setValue] = useState(query);
  const analytics = useCustomAnalytics();
  const debounced = useDebounce(value, 300);
  const router = useRouter();
  const { filters } = useFilterScope();

  return (
    <div>
      <input value={value} onChange={e => setValue(e.target.value)} />
      <span>{debounced}</span>
      <span>{router.pathname}</span>
      <span>{JSON.stringify(filters)}</span>
      <span>{JSON.stringify(analytics)}</span>
    </div>
  );
}
