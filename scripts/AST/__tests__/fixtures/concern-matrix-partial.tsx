/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

/**
 * Fixture: Container that is missing error handling and empty state.
 * Used by ast-concern-matrix tests to verify CONTAINER_MISSING_* observations
 * are emitted for absent concerns.
 */

function useAnalyticsData() {
  return {
    data: [] as string[],
    isLoading: false,
  };
}

function AnalyticsBlock({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function PartialConcernContainer() {
  const { data, isLoading } = useAnalyticsData();

  if (isLoading) {
    return <div>Loading analytics...</div>;
  }

  return <AnalyticsBlock items={data} />;
}
