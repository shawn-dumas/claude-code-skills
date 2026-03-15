import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utilsModule from '@/shared/utils';

const mockedGetDaysDiff = vi.spyOn(utilsModule, 'getDaysDiff');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateDateRange', () => {
  it('should not add issue when dateRange is undefined', () => {
    expect(ctx.addIssue).not.toHaveBeenCalled();
    expect(mockedGetDaysDiff).not.toHaveBeenCalled();
  });
  it('should not add issue when dateRange is empty array', () => {
    expect(ctx.addIssue).not.toHaveBeenCalled();
    expect(mockedGetDaysDiff).not.toHaveBeenCalled();
  });
  it('should not add issue when only start date is provided', () => {
    expect(ctx.addIssue).not.toHaveBeenCalled();
    expect(mockedGetDaysDiff).not.toHaveBeenCalled();
  });
  it('should not add issue when date diff is less than dayLimits', () => {
    expect(mockedGetDaysDiff).toHaveBeenCalledWith(start, end);
    expect(ctx.addIssue).not.toHaveBeenCalled();
  });
  it('should add issue when date diff equals dayLimits', () => {
    expect(mockedGetDaysDiff).toHaveBeenCalledWith(start, end);
    expect(ctx.addIssue).toHaveBeenCalledWith({ path: ['dateRange'], code: 'custom', message: 'Max 30 days' });
  });
  it('should add issue when date diff exceeds dayLimits', () => {
    expect(mockedGetDaysDiff).toHaveBeenCalledWith(start, end);
    expect(ctx.addIssue).toHaveBeenCalledWith({ path: ['dateRange'], code: 'custom', message: 'Max 7 days' });
  });
  it('should work with different dayLimits values', () => {
    expect(ctx.addIssue).toHaveBeenCalledWith({ path: ['dateRange'], code: 'custom', message: 'Max 90 days' });
  });
});
