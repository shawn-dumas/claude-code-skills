import { describe, it, expect } from 'vitest';
import { processData } from '../tested-a';
import { formatOutput } from '../indirectly-tested';

describe('integration', () => {
  it('processes and formats data', () => {
    const result = processData(['# hello', 'key: value']);
    const output = formatOutput(result);
    expect(output).toContain('1. hello');
    expect(output).toContain('2. key=value');
  });
});
