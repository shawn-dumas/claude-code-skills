export function usedUtil(): number {
  return 1;
}

export function obsoleteUtil(): void {
  // same name as helpers.ts, re-exported by barrel
}

export function deprecatedApi(): string {
  return 'also old';
}
