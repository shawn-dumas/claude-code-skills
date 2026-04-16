import { processB } from './serviceB';

export function processA(x: number): number {
  if (x <= 0) return x;
  return processB(x - 1);
}
