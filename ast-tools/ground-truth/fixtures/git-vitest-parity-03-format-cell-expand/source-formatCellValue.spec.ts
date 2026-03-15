import { describe, it, expect } from 'vitest';

describe('formatCellValue', () => {
  it('should format numbers to two decimal places', () => {
    expect(formatCellValue(123)).toBe('123');
    expect(formatCellValue(null)).toBe('0.00');
    expect(formatCellValue(undefined)).toBe('0.00');
  });
  it('should preserve string format', () => {
    expect(formatCellValue('1234.5')).toBe('1234.5');
  });
  it('should format based on units', () => {
    expect(formatCellValue(123.45, 'INTEGER')).toBe('123');
    expect(formatCellValue(123.45, 'PERCENTAGE')).toBe('123.46%');
    expect(formatCellValue(123.45, 'TIME')).toBe('2.1');
  });
  it('should return default for unhandled type', () => {
    expect(formatCellValue({})).toBe('0.00');
  });
  it('should format large numbers with commas', () => {
    expect(formatCellValue(1234567, 'INTEGER')).toBe('1,234,567');
    expect(formatCellValue(1000000, 'INTEGER')).toBe('1,000,000');
  });
  it('should format time with commas', () => {
    expect(formatCellValue(1234567, 'TIME')).toBe('20,576.1');
    expect(formatCellValue(1000000, 'TIME')).toBe('16,666.7');
  });
});
