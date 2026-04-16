import { processA } from './serviceA';

export function processB(x: number): number {
  if (x <= 0) return x;
  return processA(x - 1);
}
