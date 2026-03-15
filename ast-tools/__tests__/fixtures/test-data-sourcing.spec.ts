import { describe, it, expect } from 'vitest';
import { productivityFixtures } from '@/fixtures';
import { mapData } from './some-module';

describe('mapData', () => {
  it('maps fixture data', () => {
    const data = productivityFixtures.buildMappedUserStats();
    const result = mapData(data);
    expect(result).toBeDefined();
  });

  it('handles empty data with as any', () => {
    const data = {} as any;
    const data2 = { id: 1 } as any;
    const result = mapData(data);
    expect(result).toEqual([]);
  });
});
