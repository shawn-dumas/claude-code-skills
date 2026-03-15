/**
 * Dummy subject module for test-quality-with-helper.spec.ts fixture.
 * Provides a simple function so the test analysis correctly identifies
 * this as the subject under test (not the helper module).
 */

export function renderUserCard(name: string, email: string): { name: string; email: string } {
  return { name, email };
}
