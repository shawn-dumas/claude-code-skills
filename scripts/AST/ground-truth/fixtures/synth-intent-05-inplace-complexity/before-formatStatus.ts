export function formatStatus(code: number): string {
  if (code === 0) {
    return 'inactive';
  } else if (code === 1) {
    return 'active';
  } else if (code === 2) {
    return 'suspended';
  } else if (code === 3) {
    return 'archived';
  } else if (code < 0) {
    return 'error';
  } else {
    return 'unknown';
  }
}

export function isActive(code: number): boolean {
  return code === 1;
}
