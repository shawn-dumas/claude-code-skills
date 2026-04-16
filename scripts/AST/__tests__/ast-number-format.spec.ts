import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  analyzeNumberFormat,
  analyzeNumberFormatDirectory,
  extractNumberFormatObservations,
} from '../ast-number-format';
import { getSourceFile, PROJECT_ROOT } from '../project';
import type { NumberFormatAnalysis, NumberFormatObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): NumberFormatAnalysis {
  return analyzeNumberFormat(fixturePath(name));
}

function observationsOfKind(analysis: NumberFormatAnalysis, kind: NumberFormatObservationKind) {
  return analysis.observations.filter(o => o.kind === kind);
}

describe('ast-number-format', () => {
  describe('FORMAT_NUMBER_CALL', () => {
    it('detects formatNumber calls', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_NUMBER_CALL');

      expect(obs).toHaveLength(2);
      expect(obs[0].evidence.callee).toBe('formatNumber');
      expect(obs[0].evidence.containingFunction).toBe('exampleFormatNumber');
    });

    it('extracts decimalPlaces from second argument', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_NUMBER_CALL');

      // First call: formatNumber(value) -- no decimal places
      expect(obs[0].evidence.decimalPlaces).toBeUndefined();
      // Second call: formatNumber(value, 1)
      expect(obs[1].evidence.decimalPlaces).toBe(1);
    });
  });

  describe('FORMAT_INT_CALL', () => {
    it('detects formatInt calls', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_INT_CALL');

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.callee).toBe('formatInt');
      expect(obs[0].evidence.containingFunction).toBe('exampleFormatInt');
    });
  });

  describe('FORMAT_DURATION_CALL', () => {
    it('detects formatDuration calls', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_DURATION_CALL');

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.callee).toBe('formatDuration');
      expect(obs[0].evidence.containingFunction).toBe('exampleFormatDuration');
    });
  });

  describe('FORMAT_CELL_VALUE_CALL', () => {
    it('detects formatCellValue calls', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_CELL_VALUE_CALL');

      expect(obs).toHaveLength(2);
      expect(obs[0].evidence.callee).toBe('formatCellValue');
      expect(obs[0].evidence.containingFunction).toBe('exampleFormatCellValue');
    });

    it('extracts unitsType from second argument', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'FORMAT_CELL_VALUE_CALL');

      expect(obs[0].evidence.unitsType).toContain('PERCENTAGE');
      expect(obs[1].evidence.unitsType).toContain('TIME');
    });
  });

  describe('RAW_TO_FIXED', () => {
    it('detects toFixed outside formatter functions', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'RAW_TO_FIXED');

      // exampleRawToFixed and examplePercentageDisplay both have toFixed
      // examplePercentageDisplay does NOT start with 'format', so both should emit
      expect(obs.length).toBeGreaterThanOrEqual(2);
      expect(obs[0].evidence.callee).toBe('toFixed');
      expect(obs[0].evidence.decimalPlaces).toBe(2);
    });
  });

  describe('RAW_TO_LOCALE_STRING', () => {
    it('detects toLocaleString outside formatter functions', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'RAW_TO_LOCALE_STRING');

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.callee).toBe('toLocaleString');
      expect(obs[0].evidence.containingFunction).toBe('exampleRawToLocaleString');
    });
  });

  describe('PERCENTAGE_DISPLAY', () => {
    it('detects toFixed inside template literal with %', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'PERCENTAGE_DISPLAY');

      const toFixedPct = obs.find(o => o.evidence.callee === 'toFixed');
      expect(toFixedPct).toBeDefined();
      expect(toFixedPct!.evidence.decimalPlaces).toBe(2);
      expect(toFixedPct!.evidence.context).toBe('template-literal');
    });

    it('detects Math.round inside template literal with %', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'PERCENTAGE_DISPLAY');

      const roundPct = obs.find(o => o.evidence.callee === 'Math.round');
      expect(roundPct).toBeDefined();
      expect(roundPct!.evidence.decimalPlaces).toBe(0);
    });
  });

  describe('INTL_NUMBER_FORMAT', () => {
    it('detects new Intl.NumberFormat()', () => {
      const result = analyzeFixture('number-format-samples.ts');
      const obs = observationsOfKind(result, 'INTL_NUMBER_FORMAT');

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.callee).toBe('Intl.NumberFormat');
      expect(obs[0].evidence.containingFunction).toBe('exampleIntlFormat');
    });
  });
});

describe('negative fixture', () => {
  it('does NOT emit RAW_TO_FIXED for toFixed inside formatPercentage', () => {
    const result = analyzeFixture('number-format-negative.ts');
    const obs = observationsOfKind(result, 'RAW_TO_FIXED');

    // formatPercentage starts with 'format' -- suppressed
    const inFormatPercentage = obs.find(o => o.evidence.containingFunction === 'formatPercentage');
    expect(inFormatPercentage).toBeUndefined();
  });

  it('does NOT emit RAW_TO_LOCALE_STRING for toLocaleString inside formatCurrency', () => {
    const result = analyzeFixture('number-format-negative.ts');
    const obs = observationsOfKind(result, 'RAW_TO_LOCALE_STRING');

    // formatCurrency starts with 'format' -- suppressed
    const inFormatCurrency = obs.find(o => o.evidence.containingFunction === 'formatCurrency');
    expect(inFormatCurrency).toBeUndefined();
  });

  it('does NOT emit PERCENTAGE_DISPLAY for Math.round used in computation', () => {
    const result = analyzeFixture('number-format-negative.ts');
    const obs = observationsOfKind(result, 'PERCENTAGE_DISPLAY');

    // computeIndex uses Math.round but NOT in a % template/concatenation
    const inComputeIndex = obs.find(o => o.evidence.containingFunction === 'computeIndex');
    expect(inComputeIndex).toBeUndefined();
  });

  it('still emits PERCENTAGE_DISPLAY inside formatPercentage (template % detection is independent)', () => {
    const result = analyzeFixture('number-format-negative.ts');
    const obs = observationsOfKind(result, 'PERCENTAGE_DISPLAY');

    // formatPercentage has `${value.toFixed(2)}%` -- PERCENTAGE_DISPLAY should still fire
    // because PERCENTAGE_DISPLAY detection is on TemplateExpression, not suppressed by function name
    const inFormatPercentage = obs.find(o => o.evidence.containingFunction === 'formatPercentage');
    expect(inFormatPercentage).toBeDefined();
  });
});

describe('observation structure', () => {
  it('all observations have valid kind, file, line, evidence', () => {
    const result = analyzeFixture('number-format-samples.ts');
    const validKinds: NumberFormatObservationKind[] = [
      'FORMAT_NUMBER_CALL',
      'FORMAT_INT_CALL',
      'FORMAT_DURATION_CALL',
      'FORMAT_CELL_VALUE_CALL',
      'RAW_TO_FIXED',
      'RAW_TO_LOCALE_STRING',
      'PERCENTAGE_DISPLAY',
      'INTL_NUMBER_FORMAT',
    ];

    for (const obs of result.observations) {
      expect(validKinds).toContain(obs.kind);
      expect(obs.file).toBeDefined();
      expect(typeof obs.line).toBe('number');
      expect(obs.line).toBeGreaterThan(0);
      expect(obs.evidence).toBeDefined();
      expect(obs.evidence.callee).toBeDefined();
    }
  });

  it('observations are sorted by line number', () => {
    const result = analyzeFixture('number-format-samples.ts');
    for (let i = 1; i < result.observations.length; i++) {
      expect(result.observations[i].line).toBeGreaterThanOrEqual(result.observations[i - 1].line);
    }
  });
});

describe('analyzeNumberFormatDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeNumberFormatDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });

  it('filters out files with zero observations', () => {
    const results = analyzeNumberFormatDirectory(FIXTURES_DIR);
    for (const r of results) {
      expect(r.observations.length).toBeGreaterThan(0);
    }
  });
});

describe('extractNumberFormatObservations', () => {
  it('can be called directly on a SourceFile', () => {
    const sf = getSourceFile(fixturePath('number-format-samples.ts'));
    const observations = extractNumberFormatObservations(sf);
    expect(observations.length).toBeGreaterThan(0);
  });
});

describe('formatter file exemption', () => {
  it('does NOT emit RAW_TO_LOCALE_STRING for formatCellValue.ts (in formatterFilePaths)', () => {
    const result = analyzeNumberFormat(
      path.join(PROJECT_ROOT, 'src', 'shared', 'utils', 'table', 'formatCellValue', 'formatCellValue.ts'),
    );
    const rawObs = result.observations.filter(o => o.kind === 'RAW_TO_LOCALE_STRING' || o.kind === 'RAW_TO_FIXED');
    expect(rawObs).toHaveLength(0);
  });

  it('does NOT emit RAW_TO_FIXED for fixture files in src/fixtures/', () => {
    const result = analyzeNumberFormat(path.join(PROJECT_ROOT, 'src', 'fixtures', 'brand.ts'));
    const rawObs = result.observations.filter(o => o.kind === 'RAW_TO_FIXED');
    expect(rawObs).toHaveLength(0);
  });
});

describe('edge-case context paths', () => {
  function analyzeEdgeCases() {
    return analyzeNumberFormat(fixturePath('number-format-edge-cases.tsx'));
  }

  it('reports context as "argument" when a format call is passed as an argument (line 43)', () => {
    const result = analyzeEdgeCases();
    const formatCalls = result.observations.filter(o => o.kind === 'FORMAT_NUMBER_CALL');
    // exampleFormatAsArgument wraps formatNumber inside someWrapper(...)
    const asArg = formatCalls.find(o => o.evidence.context === 'argument');
    expect(asArg).toBeDefined();
    expect(asArg!.evidence.callee).toBe('formatNumber');
  });

  it('reports context as "jsx-attribute" when a format call is inside a JSX expression (line 48)', () => {
    const result = analyzeEdgeCases();
    const formatCalls = result.observations.filter(o => o.kind === 'FORMAT_NUMBER_CALL');
    // ExampleJsxFormat renders formatNumber(value) directly inside JSX
    const inJsx = formatCalls.find(o => o.evidence.context === 'jsx-attribute');
    expect(inJsx).toBeDefined();
    expect(inJsx!.evidence.callee).toBe('formatNumber');
  });

  it('returns undefined from parseNumericArg when the argument is not a NumericLiteral (line 71)', () => {
    const result = analyzeEdgeCases();
    // exampleToFixedVariable calls num.toFixed(places) where places is an Identifier
    const rawFixed = result.observations.filter(o => o.kind === 'RAW_TO_FIXED');
    const variableArg = rawFixed.find(o => o.evidence.decimalPlaces === undefined);
    expect(variableArg).toBeDefined();
  });

  it('emits PERCENTAGE_DISPLAY for a bare identifier call inside a % template (lines 288-290)', () => {
    const result = analyzeEdgeCases();
    const pctObs = result.observations.filter(o => o.kind === 'PERCENTAGE_DISPLAY');
    // exampleBareCallInPercent uses `${customRound(value)}%` where customRound is a bare identifier
    const bareCall = pctObs.find(o => o.evidence.callee === 'customRound');
    expect(bareCall).toBeDefined();
    expect(bareCall!.evidence.decimalPlaces).toBeUndefined();
  });
});
