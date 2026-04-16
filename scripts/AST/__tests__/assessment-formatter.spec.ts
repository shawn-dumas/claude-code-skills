import { describe, it, expect } from 'vitest';
import { formatAssessmentTable, type AssessmentTableConfig, type ColumnDef } from '../assessment-formatter';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface SimpleAssessment {
  line: number;
  name: string;
  kind: string;
  confidence: string;
  rationale: string[];
}

const simpleColumns: ColumnDef<SimpleAssessment>[] = [
  { header: 'Line', width: 5, align: 'right', extract: a => String(a.line) },
  { header: 'Name', width: 15, extract: a => a.name },
  { header: 'Kind', width: 12, extract: a => a.kind },
  { header: 'Confidence', width: 10, extract: a => a.confidence },
];

const simpleConfig: AssessmentTableConfig<SimpleAssessment> = {
  title: 'Test Assessments: file.ts',
  emptyMessage: 'No issues found.',
  columns: simpleColumns,
};

const sampleAssessments: SimpleAssessment[] = [
  { line: 42, name: 'doStuff', kind: 'VIOLATION', confidence: 'high', rationale: ['too complex'] },
  { line: 7, name: 'init', kind: 'OK', confidence: 'medium', rationale: ['looks fine'] },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatAssessmentTable', () => {
  it('renders title and empty message when no assessments', () => {
    const result = formatAssessmentTable(simpleConfig, []);
    const lines = result.split('\n');
    expect(lines[0]).toBe('Test Assessments: file.ts');
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('No issues found.');
    expect(lines).toHaveLength(3);
  });

  it('renders header, separator, and data rows', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    const lines = result.split('\n');

    // Title + blank
    expect(lines[0]).toBe('Test Assessments: file.ts');
    expect(lines[1]).toBe('');

    // Header
    expect(lines[2]).toContain('Line');
    expect(lines[2]).toContain('Name');
    expect(lines[2]).toContain('Kind');
    expect(lines[2]).toContain('Confidence');

    // Separator uses dashes and plus signs
    expect(lines[3]).toMatch(/^[-+]+$/);
    expect(lines[3]).toContain('+');

    // Data rows
    expect(lines[4]).toContain('42');
    expect(lines[4]).toContain('doStuff');
    expect(lines[4]).toContain('VIOLATION');
    expect(lines[4]).toContain('high');
    expect(lines[5]).toContain('7');
    expect(lines[5]).toContain('init');

    // No rationale section
    expect(lines).toHaveLength(6);
  });

  it('right-aligns columns when align is "right"', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    const lines = result.split('\n');

    // Line column is right-aligned (width 5), value "42" should be padded left
    const dataRow = lines[4];
    const lineCell = dataRow.split(' | ')[0];
    expect(lineCell).toBe('   42');

    // Header "Line" should also be right-aligned
    const headerRow = lines[2];
    const headerCell = headerRow.split(' | ')[0];
    expect(headerCell).toBe(' Line');
  });

  it('left-aligns columns by default', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    const lines = result.split('\n');

    // Name column is left-aligned (width 15)
    const dataRow = lines[4];
    const nameCell = dataRow.split(' | ')[1];
    expect(nameCell).toBe('doStuff        ');
  });

  it('truncates values exceeding column width', () => {
    const longAssessment: SimpleAssessment = {
      line: 1,
      name: 'thisIsAVeryLongFunctionName',
      kind: 'SOME_VERY_LONG_KIND',
      confidence: 'high',
      rationale: [],
    };
    const result = formatAssessmentTable(simpleConfig, [longAssessment]);
    const lines = result.split('\n');
    const dataRow = lines[4];
    const nameCell = dataRow.split(' | ')[1];
    // width 15, so truncated to 15 chars
    expect(nameCell).toBe('thisIsAVeryLong');
  });

  it('uses effective width = max(width, header.length) for columns', () => {
    const narrowConfig: AssessmentTableConfig<SimpleAssessment> = {
      title: 'Narrow Test',
      emptyMessage: 'Empty.',
      columns: [
        // width 3 but header "Confidence" is 10 chars -- effective width should be 10
        { header: 'Confidence', width: 3, extract: a => a.confidence },
      ],
    };
    const result = formatAssessmentTable(narrowConfig, [sampleAssessments[0]]);
    const lines = result.split('\n');

    // Header should be full "Confidence" (10 chars, not truncated to 3)
    expect(lines[2]).toBe('Confidence');

    // Data should be padded to 10
    expect(lines[4]).toBe('high      ');

    // Separator should be 10 dashes
    expect(lines[3]).toBe('----------');
  });

  it('renders rationale section when config.rationale is provided', () => {
    const withRationale: AssessmentTableConfig<SimpleAssessment> = {
      ...simpleConfig,
      rationale: a => `  ${a.name}: ${a.rationale.join('; ')}`,
    };
    const result = formatAssessmentTable(withRationale, sampleAssessments);
    const lines = result.split('\n');

    // After data rows: blank line, "Rationale:", then entries
    const rationaleIdx = lines.indexOf('Rationale:');
    expect(rationaleIdx).toBeGreaterThan(0);
    expect(lines[rationaleIdx - 1]).toBe('');
    expect(lines[rationaleIdx + 1]).toBe('  doStuff: too complex');
    expect(lines[rationaleIdx + 2]).toBe('  init: looks fine');
  });

  it('omits rationale section when config.rationale is undefined', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    expect(result).not.toContain('Rationale:');
  });

  it('separator length matches header length', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    const lines = result.split('\n');
    expect(lines[3].length).toBe(lines[2].length);
  });

  it('separator uses + at pipe positions', () => {
    const result = formatAssessmentTable(simpleConfig, sampleAssessments);
    const lines = result.split('\n');
    const header = lines[2];
    const separator = lines[3];

    for (let i = 0; i < header.length; i++) {
      if (header[i] === '|') {
        expect(separator[i]).toBe('+');
      } else {
        expect(separator[i]).toBe('-');
      }
    }
  });

  it('handles single-column table', () => {
    const singleCol: AssessmentTableConfig<SimpleAssessment> = {
      title: 'Single Column',
      emptyMessage: 'Empty.',
      columns: [{ header: 'Kind', width: 10, extract: a => a.kind }],
    };
    const result = formatAssessmentTable(singleCol, [sampleAssessments[0]]);
    const lines = result.split('\n');
    expect(lines[2]).toBe('Kind      ');
    expect(lines[3]).toBe('----------');
    expect(lines[4]).toBe('VIOLATION ');
  });

  it('handles many rows without issue', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      line: i,
      name: `fn${i}`,
      kind: 'OK',
      confidence: 'low',
      rationale: [],
    }));
    const result = formatAssessmentTable(simpleConfig, many);
    const lines = result.split('\n');
    // title + blank + header + separator + 100 data rows
    expect(lines).toHaveLength(104);
  });

  it('works with empty string extract values', () => {
    const emptyData: SimpleAssessment = {
      line: 0,
      name: '',
      kind: '',
      confidence: '',
      rationale: [],
    };
    const result = formatAssessmentTable(simpleConfig, [emptyData]);
    const lines = result.split('\n');
    // Should still produce a valid row with padded empty strings
    expect(lines[4]).toContain(' | ');
    expect(lines).toHaveLength(5);
  });
});
