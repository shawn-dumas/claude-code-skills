/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

/**
 * Fixture: Container in a /pages/ path that HANDLES permission.
 * Placed under __tests__/fixtures/pages/ so isPermissionApplicable returns true.
 * Used to cover CONTAINER_HANDLES_PERMISSION (line 419) and
 * buildSummary permApplicable + handlesPermission path (lines 447-448).
 */

function useTeamData() {
  return {
    data: [] as string[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  };
}

function RequireRoles({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function QueryErrorFallback({ error }: { error: Error | null }) {
  return <div>Error: {error?.message}</div>;
}

function PlaceholderContainer({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export function TeamPageContainer() {
  const { data, isLoading, isError, error } = useTeamData();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <QueryErrorFallback error={error} />;
  }

  if (!data || data.length === 0) {
    return <PlaceholderContainer>No teams found</PlaceholderContainer>;
  }

  return (
    <RequireRoles>
      <ul>
        {data.map(item => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </RequireRoles>
  );
}
