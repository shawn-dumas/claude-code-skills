/**
 * Another tested production file -- has a dedicated spec.
 */
export function validateEmail(email: string): boolean {
  if (!email) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  if (parts[0].length === 0 || parts[1].length === 0) return false;
  return parts[1].includes('.');
}
