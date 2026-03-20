export function computeHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}

export function normalizeString(input: string): string {
  if (!input) {
    return '';
  }
  return input.trim().toLowerCase();
}
