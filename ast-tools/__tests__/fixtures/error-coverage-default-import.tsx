/* eslint-disable */
// Fixture: hook imported via default import
// Exercises resolveHookImportSource default-import path (lines 295-302)

import React from 'react';
import useTeamDefaultQuery from './error-coverage-default-hook';

export function DefaultImportContainer() {
  const { data, isLoading, isError } = useTeamDefaultQuery({ teamId: '1' });

  if (isError) return <div>Error</div>;
  if (isLoading) return <div>Loading...</div>;
  return <div>{String(data)}</div>;
}
