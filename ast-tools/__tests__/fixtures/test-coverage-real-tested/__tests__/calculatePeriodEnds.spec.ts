import { calculatePeriodEndsByDates, calculatePeriodEndsByDays } from '../calculatePeriodEnds';

describe('calculatePeriodEnds', () => {
  it('returns start and end times for date range', () => {
    const result = calculatePeriodEndsByDates([new Date('2024-01-01'), new Date('2024-01-31')], 'UTC');
    expect(result.startTime).toBeDefined();
    expect(result.endTime).toBeDefined();
  });

  it('throws for invalid dates', () => {
    expect(() => calculatePeriodEndsByDates([new Date('invalid'), new Date()], 'UTC')).toThrow('Invalid date');
  });

  it('returns lookback window', () => {
    const now = new Date('2024-06-15T12:00:00Z');
    const result = calculatePeriodEndsByDays(7, 'UTC', now);
    expect(result.startTime).toBeDefined();
    expect(result.endTime).toBeDefined();
  });
});
