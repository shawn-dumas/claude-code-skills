/* eslint-disable */
// Fixture file for ast-error-coverage tests.
// Contains positive and negative cases for error coverage classification.

import React from 'react';

// --- Simulated hooks (no real imports needed for AST analysis) ---

function useTeamDataQuery(_params: unknown, _opts?: unknown) {
  return { data: null, isLoading: false, isError: false, error: null };
}

function useUpdateTeamMutation(_opts?: unknown) {
  return { mutateAsync: async () => {}, mutate: () => {}, isError: false };
}

function useDeleteItemMutation(_opts?: unknown) {
  return { mutateAsync: async () => {}, mutate: () => {} };
}

function useNoErrorQuery() {
  return { data: [], isLoading: false };
}

// --- Positive: QUERY_ERROR_HANDLED ---

export function HandledQueryContainer() {
  const { data, isLoading, isError } = useTeamDataQuery({ teamId: '1' });

  if (isError) return <div>Error loading data</div>;
  if (isLoading) return <div>Loading...</div>;

  return <div>{JSON.stringify(data)}</div>;
}

// --- Positive: QUERY_ERROR_UNHANDLED ---

export function UnhandledQueryContainer() {
  const { data, isLoading } = useTeamDataQuery({ teamId: '2' });

  if (isLoading) return <div>Loading...</div>;

  return <div>{JSON.stringify(data)}</div>;
}

// --- Positive: MUTATION_ERROR_HANDLED (onError in options) ---

export function HandledMutationContainer() {
  const { mutateAsync } = useUpdateTeamMutation({
    onError: (err: unknown) => {
      console.error('Mutation failed', err);
    },
  });

  const handleSave = async () => {
    await mutateAsync();
  };

  return <button onClick={handleSave}>Save</button>;
}

// --- Positive: MUTATION_ERROR_UNHANDLED ---

export function UnhandledMutationContainer() {
  const { mutateAsync } = useDeleteItemMutation();

  const handleDelete = async () => {
    await mutateAsync();
  };

  return <button onClick={handleDelete}>Delete</button>;
}

// --- Positive: QUERY_ERROR_HANDLED via renamed destructuring ---

export function RenamedErrorContainer() {
  const { data, isError: teamError } = useTeamDataQuery({ teamId: '3' });

  if (teamError) return <div>Error loading data</div>;

  return <div>{JSON.stringify(data)}</div>;
}

// --- Positive: QUERY_ERROR_HANDLED via throwOnError in options ---

export function ThrowOnErrorContainer() {
  const { data } = useTeamDataQuery({ teamId: '4' }, { throwOnError: true });

  return <div>{JSON.stringify(data)}</div>;
}

// --- Positive: QUERY_ERROR_HANDLED via 'error' destructuring ---

export function ErrorObjectContainer() {
  const { data, error } = useTeamDataQuery({ teamId: '5' });

  if (error) return <div>Error: {error.message}</div>;

  return <div>{JSON.stringify(data)}</div>;
}

// --- Positive: MUTATION_ERROR_HANDLED via try-catch ---

export function TryCatchMutationContainer() {
  const { mutateAsync } = useDeleteItemMutation();

  const handleDelete = async () => {
    try {
      await mutateAsync();
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  return <button onClick={handleDelete}>Delete</button>;
}

// --- Negative: Component with no hooks ---

export function PlainComponent({ name }: { name: string }) {
  return <div>Hello {name}</div>;
}
