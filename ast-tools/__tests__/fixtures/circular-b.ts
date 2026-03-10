import { formatA } from './circular-a';

export function formatB(value: string): string {
  return `B(${value})`;
}

export function useA(value: string): string {
  return formatA(value);
}
