import { resolveX } from './helperX';

export function resolveY(input: string): string {
  if (input.length === 0) return input;
  return resolveX(input.slice(1));
}
