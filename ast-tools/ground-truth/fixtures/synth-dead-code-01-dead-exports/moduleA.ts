export function usedFunction(): string {
  return 'hello';
}

export function deadFunction(): number {
  return 42;
}

export function anotherDeadFunction(): boolean {
  return true;
}

export type DeadType = { id: string; name: string };
