/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

/**
 * Fixture: Container in a /pages/ path that is MISSING permission handling.
 * Placed under __tests__/fixtures/pages/ so isPermissionApplicable returns true.
 * Used to cover CONTAINER_MISSING_PERMISSION (line 421).
 */

function useReportData() {
  return {
    data: [] as string[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  };
}

function QueryErrorFallback({ error }: { error: Error | null }) {
  return <div>Error: {error?.message}</div>;
}

function PlaceholderContainer({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export function ReportPageContainer() {
  const { data, isLoading, isError, error } = useReportData();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <QueryErrorFallback error={error} />;
  }

  if (!data || data.length === 0) {
    return <PlaceholderContainer>No reports found</PlaceholderContainer>;
  }

  return (
    <ul>
      {data.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
