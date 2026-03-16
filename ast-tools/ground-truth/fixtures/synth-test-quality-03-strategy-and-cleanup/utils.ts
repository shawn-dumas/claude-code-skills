export function formatValue(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
