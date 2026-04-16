/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

/**
 * Fixture: Container that handles all required concerns.
 * Used by ast-concern-matrix tests to verify zero CONTAINER_MISSING_* observations.
 */

function useProjectData() {
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

function ProjectBlock({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function CompleteConcernContainer() {
  const { data, isLoading, isError, error } = useProjectData();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <QueryErrorFallback error={error} />;
  }

  if (!data || data.length === 0) {
    return <PlaceholderContainer>No projects found</PlaceholderContainer>;
  }

  return <ProjectBlock items={data} />;
}
