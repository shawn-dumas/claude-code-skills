import { describe, it, expect } from 'vitest';

describe('formatCellValue', () => {
  describe('invalid inputs', () => {
    it('should return dash for non-numeric', () => {
      expect(formatCellValue(null)).toBe('-');
      expect(formatCellValue(undefined)).toBe('-');
    });
  });
  describe('without units', () => {
    it('should format numbers to two decimal places', () => {
      expect(formatCellValue(123.456)).toBe('123.46');
      expect(formatCellValue(1000.5)).toBe('1,000.5');
    });
    it('should format string numbers', () => {
      expect(formatCellValue('99.5')).toBe('99.5');
    });
  });
  describe('INTEGER', () => {
    it('should format large numbers with commas', () => {
      expect(formatCellValue(1234567, 'INTEGER')).toBe('1,234,567');
      expect(formatCellValue(1000000, 'INTEGER')).toBe('1,000,000');
      expect(formatCellValue(999, 'INTEGER')).toBe('999');
    });
  });
  describe('PERCENTAGE', () => {
    it('should format with percent sign', () => {
      expect(formatCellValue(50, 'PERCENTAGE')).toBe('50.00%');
      expect(formatCellValue(99.999, 'PERCENTAGE')).toBe('100.00%');
    });
  });
  describe('TIME', () => {
    it('should format time with commas', () => {
      expect(formatCellValue(1234567, 'TIME')).toBe('20,576.1');
      expect(formatCellValue(1000000, 'TIME')).toBe('16,666.7');
    });
    it('should convert seconds to minutes', () => {
      expect(formatCellValue(120, 'TIME')).toBe('2');
    });
  });
});
