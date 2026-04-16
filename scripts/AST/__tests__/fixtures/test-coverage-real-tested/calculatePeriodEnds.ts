/**
 * Simplified version of src/shared/utils/calculatePeriodEnds/calculatePeriodEnds.ts.
 * Real file uses Temporal API for timezone-aware date math.
 */

function safeTimeZone(tz: string): string {
  if (!tz) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

export function calculatePeriodEndsByDates(
  dates: [Date, Date],
  timeZone: string,
): { startTime: string; endTime: string } {
  if (dates.some(d => Number.isNaN(d.getTime()))) {
    throw new Error('Invalid date in calculatePeriodEnds');
  }
  const tz = safeTimeZone(timeZone);
  return {
    startTime: new Date(dates[0].toLocaleString('en-US', { timeZone: tz })).toISOString(),
    endTime: new Date(dates[1].toLocaleString('en-US', { timeZone: tz })).toISOString(),
  };
}

export function calculatePeriodEndsByDays(
  days: number,
  timeZone: string,
  now?: Date,
): { startTime: string; endTime: string } {
  const tz = safeTimeZone(timeZone);
  const ref = now ?? new Date();
  const start = new Date(ref.getTime() - Math.abs(days) * 24 * 60 * 60 * 1000);
  return {
    startTime: new Date(start.toLocaleString('en-US', { timeZone: tz })).toISOString(),
    endTime: ref.toISOString(),
  };
}
