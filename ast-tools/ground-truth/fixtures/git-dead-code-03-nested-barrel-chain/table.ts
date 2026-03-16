/**
 * Stripped from src/shared/types/table.ts
 * PageSizeValue is consumed externally. DeprecatedPageSize is dead.
 */
export const PageSizeValue = {
  SMALL: 25,
  MEDIUM: 50,
  LARGE: 100,
  ALL: 500,
} as const;

export type PageSizeValue = (typeof PageSizeValue)[keyof typeof PageSizeValue];

/** Dead export -- was replaced by PageSizeValue, no consumers remain */
export const DeprecatedPageSize = {
  DEFAULT: 25,
  MAX: 100,
} as const;

export type DeprecatedPageSize = (typeof DeprecatedPageSize)[keyof typeof DeprecatedPageSize];
