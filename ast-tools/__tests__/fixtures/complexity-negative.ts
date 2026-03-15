/* eslint-disable */
// Negative fixture: only type definitions, no functions.
// Should produce zero FUNCTION_COMPLEXITY observations.

export type UserId = string & { readonly __brand: 'UserId' };

export interface TeamMember {
  id: UserId;
  name: string;
  role: 'admin' | 'member' | 'viewer';
}

export type TeamId = string & { readonly __brand: 'TeamId' };

type FilterOptions = {
  includeDeleted?: boolean;
  sortBy?: keyof TeamMember;
};
