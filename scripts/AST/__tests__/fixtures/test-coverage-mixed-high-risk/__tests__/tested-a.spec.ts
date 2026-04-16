import { describe, it, expect } from 'vitest';
import { processData, summarizeResults } from '../tested-a';

describe('processData', () => {
  it('returns empty for empty input', () => {
    expect(processData([])).toEqual([]);
  });

  it('strips # prefix', () => {
    expect(processData(['# hello'])).toEqual(['hello']);
  });

  it('converts key:value format', () => {
    expect(processData(['name: Alice'])).toEqual(['name=Alice']);
  });
});

describe('summarizeResults', () => {
  it('counts items', () => {
    expect(summarizeResults(['a', 'b'])).toEqual({ count: 2, first: 'a' });
  });
});
