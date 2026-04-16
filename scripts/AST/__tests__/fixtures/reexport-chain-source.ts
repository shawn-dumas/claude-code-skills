// Source file with actual declarations for re-export chain tests

export function chainedFunction(): string {
  return 'chained';
}

export type ChainedType = { value: number };

export const CHAINED_CONST = 42;

export default function defaultExport(): void {
  // default export for re-export tests
}
