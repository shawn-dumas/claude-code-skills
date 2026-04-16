/* eslint-disable @typescript-eslint/no-unused-vars */
import React from 'react';

// ---------------------------------------------------------------------------
// Fixture 1: Container that handles all 3 concerns (loading + error + empty)
// ---------------------------------------------------------------------------

function useTeamData() {
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

function TeamBlock({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function FullCoverageContainer() {
  const { data, isLoading, isError, error } = useTeamData();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (isError) {
    return <QueryErrorFallback error={error} />;
  }

  if (!data || data.length === 0) {
    return <PlaceholderContainer>No data available</PlaceholderContainer>;
  }

  return <TeamBlock items={data} />;
}

// ---------------------------------------------------------------------------
// Fixture 2: Container that handles loading but misses error and empty
// ---------------------------------------------------------------------------

function useDashboardData() {
  return {
    data: [] as string[],
    isLoading: false,
    isPending: false,
  };
}

function DashboardBlock({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export function PartialCoverageContainer() {
  const { data, isPending } = useDashboardData();

  if (isPending) {
    return <div>Loading dashboard...</div>;
  }

  return <DashboardBlock items={data} />;
}

// ---------------------------------------------------------------------------
// Fixture 3: Plain presentational component (no query hooks)
// ---------------------------------------------------------------------------

interface CardProps {
  title: string;
  description: string;
}

export function PresentationalCard({ title, description }: CardProps) {
  return (
    <div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
