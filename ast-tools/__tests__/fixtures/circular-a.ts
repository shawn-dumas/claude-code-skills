import { formatB } from './circular-b';

export function formatA(value: string): string {
  return `A(${value})`;
}

export function useB(value: string): string {
  return formatB(value);
}
