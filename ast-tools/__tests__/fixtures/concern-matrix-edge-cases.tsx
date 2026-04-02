/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useState } from 'react';

/**
 * Fixture: Edge-case concern patterns.
 *
 * 1. CustomSignalContainer -- uses a JSX tag with 'Error' in its name (not in ERROR_JSX_NAMES)
 *    and a JSX element with a `placeholder` prop.
 * 2. MutationOnlyContainer -- mutation-only; CONTAINER_MISSING_LOADING must NOT be emitted.
 * 3. NoLoadingSignalContainer -- query hook with no loading signal; emits CONTAINER_MISSING_LOADING.
 * 4. LoadingJsxContainer -- uses <Spinner> from LOADING_JSX_NAMES to signal loading.
 * 5. UseStateLoadingContainer -- uses useState with a loading name to signal loading.
 * 6. PermissionHookContainer -- uses useAuthState (PERMISSION_HOOKS) for permission signal.
 */

function useTeamQuery() {
  return {
    data: [] as string[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
  };
}

function useDataOnly() {
  return {
    data: [] as string[],
    isError: false,
  };
}

function useSubmitMutation() {
  return {
    mutate: (_data: string) => {},
  };
}

function useAuthState() {
  return { user: null, allowedRoles: [] as string[] };
}

// A custom error component whose tag name contains 'Error' (but is not in ERROR_JSX_NAMES)
function CustomErrorView({ message }: { message: string }) {
  return <div className='error'>{message}</div>;
}

// A spinner component in LOADING_JSX_NAMES
function Spinner() {
  return <div className='spinner' />;
}

// An input-like component used for empty state with a placeholder prop
function EmptyPlaceholderInput({ placeholder }: { placeholder: string }) {
  return <input placeholder={placeholder} />;
}

// Covers lines 242 (custom Error JSX tag) and 287 (placeholder prop)
export function CustomSignalContainer() {
  const { data, isLoading, isError, error } = useTeamQuery();

  if (isLoading) return <div>Loading...</div>;

  if (isError) return <CustomErrorView message={error?.message ?? ''} />;

  if (!data || data.length === 0) {
    return <EmptyPlaceholderInput placeholder='No items found' />;
  }

  return (
    <ul>
      {data.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

// Mutation-only container: isMutationOnly = true -> CONTAINER_MISSING_LOADING NOT emitted (lines 399-400)
export function MutationOnlyContainer() {
  const { mutate } = useSubmitMutation();

  return <button onClick={() => mutate('value')}>Submit</button>;
}

// Query hook but no loading signal destructured -> CONTAINER_MISSING_LOADING IS emitted (line 400)
export function NoLoadingSignalContainer() {
  const { data, isError } = useDataOnly();

  if (isError) return <div>Error</div>;

  return <div>{data.join(', ')}</div>;
}

// Uses <Spinner> (in LOADING_JSX_NAMES) to signal loading -- covers line 163
export function LoadingJsxContainer() {
  const { data, isLoading, isError } = useTeamQuery();

  if (isLoading) return <Spinner />;

  if (isError) return <div>Error loading</div>;

  if (!data || data.length === 0) return <div>No data</div>;

  return (
    <ul>
      {data.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

// Uses useState with a loading-pattern name -- covers lines 176-178
export function UseStateLoadingContainer() {
  const [isLoading, setIsLoading] = useState(false);
  const { data, isError } = useDataOnly();

  if (isLoading) return <div>Loading...</div>;

  if (isError) return <div>Error</div>;

  if (!data || data.length === 0) return <div>No data</div>;

  return (
    <ul>
      {data.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

// Uses useAuthState (PERMISSION_HOOKS) and destructures allowedRoles (PERMISSION_IDENTIFIERS)
// -- covers lines 203 and 208
export function PermissionHookContainer() {
  const { allowedRoles } = useAuthState();
  const { data, isLoading, isError } = useTeamQuery();

  if (isLoading) return <div>Loading...</div>;

  if (isError) return <div>Error</div>;

  if (!data || data.length === 0) return <div>No items</div>;

  return (
    <ul>
      {data.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}
