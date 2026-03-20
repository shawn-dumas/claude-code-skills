/**
 * Untested but very simple (low CC, small file).
 */
export const DEFAULT_LIMIT = 100;

export function clampValue(value: number): number {
  return Math.min(value, DEFAULT_LIMIT);
}
