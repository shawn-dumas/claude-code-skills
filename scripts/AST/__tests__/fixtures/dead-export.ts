export function usedFunction(): string {
  return 'used';
}

export function unusedFunction(): string {
  return 'nobody imports this';
}

export const USED_CONST = 42;

export const UNUSED_CONST = 'dead';
