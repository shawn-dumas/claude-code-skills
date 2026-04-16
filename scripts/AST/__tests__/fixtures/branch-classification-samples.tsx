/* eslint-disable */
// Test fixture for branch classification interpreter.
// Each function exercises a specific classification kind.

import React from 'react';

// ---------------------------------------------------------------------------
// TYPE_DISPATCH: discriminant === 'literal'
// ---------------------------------------------------------------------------

type FiltersType = 'teamProductivity' | 'userProductivity' | 'systems';

function typeDispatchExample(filtersType: FiltersType) {
  if (filtersType === 'teamProductivity') {
    return 'team';
  } else if (filtersType === 'userProductivity') {
    return 'user';
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// NULL_GUARD: null/undefined checks and nullish coalesce
// ---------------------------------------------------------------------------

function nullGuardExample(user: { name: string } | null, fallback: string) {
  if (user != null) {
    return user.name;
  }
  const name = user ?? fallback;
  return name;
}

function nullGuardUndefinedExample(value: string | undefined) {
  if (value !== undefined) {
    return value;
  }
  return 'default';
}

// ---------------------------------------------------------------------------
// ERROR_CHECK: error identifiers and negated data
// ---------------------------------------------------------------------------

function errorCheckExample(isError: boolean, data: unknown) {
  if (isError) {
    return 'error state';
  }
  if (!data) {
    return 'no data';
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// FEATURE_FLAG: featureFlags.X patterns
// ---------------------------------------------------------------------------

interface FeatureFlags {
  showWorkstreams: boolean;
  enableChat: boolean;
}

function featureFlagExample(featureFlags: FeatureFlags) {
  if (featureFlags.showWorkstreams) {
    return 'workstreams visible';
  }
  return 'hidden';
}

// ---------------------------------------------------------------------------
// LOADING_CHECK: loading identifiers
// ---------------------------------------------------------------------------

function loadingCheckExample(isLoading: boolean, isPending: boolean) {
  if (isLoading) {
    return 'loading...';
  }
  if (isPending) {
    return 'pending...';
  }
  return 'ready';
}

// ---------------------------------------------------------------------------
// BOOLEAN_GUARD: is*, has*, should*, etc.
// ---------------------------------------------------------------------------

function booleanGuardExample(isAdmin: boolean, hasPermission: boolean) {
  if (isAdmin) {
    return 'admin view';
  }
  if (hasPermission) {
    return 'permitted';
  }
  return 'restricted';
}

// ---------------------------------------------------------------------------
// OTHER: complex computed condition
// ---------------------------------------------------------------------------

function otherExample(items: string[], threshold: number) {
  if (items.length > threshold + 2) {
    return 'too many';
  }
  return 'ok';
}

// ---------------------------------------------------------------------------
// TERNARY examples
// ---------------------------------------------------------------------------

function ternaryExamples(filtersType: FiltersType, user: { name: string } | null, featureFlags: FeatureFlags) {
  const label = filtersType === 'systems' ? 'Systems' : 'Other';
  const name = user !== null ? user.name : 'Unknown';
  const flag = featureFlags.enableChat ? 'chat' : 'no-chat';
  return { label, name, flag };
}

// ---------------------------------------------------------------------------
// LOGICAL_AND / LOGICAL_OR examples
// ---------------------------------------------------------------------------

function logicalExamples(isAdmin: boolean, data: unknown) {
  const result = isAdmin && 'admin-content';
  const fallback = data || 'default';
  return { result, fallback };
}

// ---------------------------------------------------------------------------
// Long-condition example (for truncation coverage)
// ---------------------------------------------------------------------------

// This function has a condition longer than 120 chars so truncateCondition is exercised.
function longConditionExample(
  veryLongVariableNameThatExceedsTheMaximumAllowedConditionLength: boolean,
  anotherLongVariableName: boolean,
) {
  if (
    veryLongVariableNameThatExceedsTheMaximumAllowedConditionLength &&
    anotherLongVariableName &&
    veryLongVariableNameThatExceedsTheMaximumAllowedConditionLength
  ) {
    return 'yes';
  }
  return 'no';
}

export {
  typeDispatchExample,
  nullGuardExample,
  nullGuardUndefinedExample,
  errorCheckExample,
  featureFlagExample,
  loadingCheckExample,
  booleanGuardExample,
  otherExample,
  ternaryExamples,
  logicalExamples,
  longConditionExample,
};
