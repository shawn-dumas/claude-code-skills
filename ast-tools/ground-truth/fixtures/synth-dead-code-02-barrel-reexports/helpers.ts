export function formatValue(x: number): string {
  return x.toFixed(2);
}

export function obsoleteUtil(): void {
  // nobody uses this anywhere
}

export function deprecatedApi(): string {
  return 'old';
}
