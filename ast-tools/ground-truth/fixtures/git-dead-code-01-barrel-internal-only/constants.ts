/**
 * Stripped from src/shared/utils/color/extendColorsSet/constants.ts
 * Exports COLORS (value) and Colors (type).
 * Consumed by extendColorsSet.ts (sibling) and re-exported by index.ts (barrel).
 * The outer barrel (color/index.ts, not included) does NOT re-export these.
 */
export const COLORS = ['red', 'blue', 'yellow', 'green', 'purple'] as const;

export type Colors = (typeof COLORS)[number];
