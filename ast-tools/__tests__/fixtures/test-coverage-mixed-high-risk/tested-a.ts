/**
 * A tested production file -- has a dedicated spec.
 */
export function processData(input: string[]): string[] {
  if (!input || input.length === 0) {
    return [];
  }

  const results: string[] = [];
  for (const item of input) {
    if (item.startsWith('#')) {
      results.push(item.slice(1).trim());
    } else if (item.includes(':')) {
      const [key, value] = item.split(':');
      results.push(`${key.trim()}=${value.trim()}`);
    } else {
      results.push(item.toLowerCase());
    }
  }

  return results;
}

export function summarizeResults(data: string[]): { count: number; first: string | null } {
  return {
    count: data.length,
    first: data.length > 0 ? data[0] : null,
  };
}
