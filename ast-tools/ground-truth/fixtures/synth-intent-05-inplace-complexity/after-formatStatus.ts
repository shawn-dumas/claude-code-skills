const STATUS_MAP: Record<number, string> = {
  0: 'inactive',
  1: 'active',
  2: 'suspended',
  3: 'archived',
};

export function formatStatus(code: number): string {
  if (code < 0) return 'error';
  return STATUS_MAP[code] ?? 'unknown';
}

export function isActive(code: number): boolean {
  return code === 1;
}
