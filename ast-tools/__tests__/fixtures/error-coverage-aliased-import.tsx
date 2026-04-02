/* eslint-disable */
// Fixture: hook imported with alias to exercise the aliased-import branch
// in resolveHookImportSource (lines 285-292).

import React from 'react';
// Import with alias: useTeamDataQuery is available locally as useAliasedQuery
import { useTeamDataQuery as useAliasedQuery } from './error-coverage-samples';

export function AliasedImportContainer() {
  const { data, isLoading, isError } = useAliasedQuery({ teamId: '1' });

  if (isError) return <div>Error</div>;
  if (isLoading) return <div>Loading...</div>;
  return <div>{String(data)}</div>;
}
