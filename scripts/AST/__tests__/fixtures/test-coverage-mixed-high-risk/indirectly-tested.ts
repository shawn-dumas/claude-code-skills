/**
 * A module imported by a spec file (indirectly tested) but
 * does not have its own dedicated spec file.
 */
export function formatOutput(items: string[]): string {
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n');
}
