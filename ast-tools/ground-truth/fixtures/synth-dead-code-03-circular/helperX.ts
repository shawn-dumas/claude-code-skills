import { resolveY } from './helperY';

export function resolveX(input: string): string {
  if (input.length === 0) return input;
  return resolveY(input.slice(1));
}
