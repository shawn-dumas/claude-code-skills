import { usedFunction, USED_CONST } from './dead-export';

export function consume(): string {
  return usedFunction() + String(USED_CONST);
}
