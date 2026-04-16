import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeNrServer, analyzeNrServerDirectory } from '../ast-nr-server';
import type { NrServerAnalysis, NrServerObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): NrServerAnalysis {
  return analyzeNrServer(fixturePath(name));
}

function obsOfKind(analysis: NrServerAnalysis, kind: NrServerObservationKind) {
  return analysis.observations.filter(o => o.kind === kind);
}

describe('ast-nr-server', () => {
  describe('positive observations (existing NR integration)', () => {
    it('detects newrelic import', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const imports = obsOfKind(result, 'NR_APM_IMPORT');

      expect(imports).toHaveLength(1);
      expect(imports[0].evidence.callSite).toContain('newrelic');
    });

    it('detects newrelic.noticeError calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const calls = obsOfKind(result, 'NR_NOTICE_ERROR_CALL');

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].evidence.containingFunction).toBe('handleError');
    });

    it('detects newrelic.addCustomAttributes calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const calls = obsOfKind(result, 'NR_CUSTOM_ATTRS_CALL');

      expect(calls).toHaveLength(1);
      expect(calls[0].evidence.containingFunction).toBe('setUserContext');
    });

    it('detects newrelic.startSegment calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const segments = obsOfKind(result, 'NR_CUSTOM_SEGMENT');

      expect(segments).toHaveLength(1);
      expect(segments[0].evidence.containingFunction).toBe('queryWithSegment');
    });
  });

  describe('gap observations (missing NR integration)', () => {
    it('detects catch block with console.error but no NR noticeError', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_REPORT');

      const noNr = missing.find(o => o.evidence.containingFunction === 'missingNrReport');
      expect(noNr).toBeDefined();
      expect(noNr!.evidence.errorSink).toBe('console.error');
    });

    it('does not flag catch block that already has NR noticeError', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_REPORT');

      const withNr = missing.find(o => o.evidence.containingFunction === 'withNrReport');
      expect(withNr).toBeUndefined();
    });
  });

  describe('summary', () => {
    it('counts APM imports, noticeError calls, and missing gaps', () => {
      const result = analyzeFixture('nr-server-samples.ts');

      expect(result.summary.apmImports).toBe(1);
      expect(result.summary.noticeErrorCalls).toBeGreaterThanOrEqual(1);
      expect(result.summary.customAttrsCalls).toBe(1);
      expect(result.summary.missingCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('directory analysis', () => {
    it('analyzes a directory and returns results', () => {
      const results = analyzeNrServerDirectory(FIXTURES_DIR);

      const fixture = results.find(r => r.filePath.includes('nr-server-samples'));
      expect(fixture).toBeDefined();
      expect(fixture!.observations.length).toBeGreaterThan(0);
    });
  });

  describe('real-world smoke tests', () => {
    it('withErrorHandler.ts has 1 NR_MISSING_ERROR_REPORT (console.error, no noticeError)', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_REPORT');

      expect(missing).toHaveLength(1);
      expect(missing[0].evidence.containingFunction).toBe('withErrorHandler');
    });

    it('withAuth.ts has 1 NR_MISSING_CUSTOM_ATTRS (has userId, no addCustomAttributes)', () => {
      const result = analyzeNrServer('src/server/middleware/withAuth.ts');
      const missing = obsOfKind(result, 'NR_MISSING_CUSTOM_ATTRS');

      expect(missing).toHaveLength(1);
      expect(missing[0].evidence.middleware).toBe('withAuth');
    });

    it('withErrorHandler.ts has 0 positive NR observations (no APM installed)', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const positive = obsOfKind(result, 'NR_APM_IMPORT');

      expect(positive).toHaveLength(0);
    });

    it('withErrorHandler.ts has 1 NR_MISSING_STARTUP_HOOK (no instrumentation.ts)', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const missing = obsOfKind(result, 'NR_MISSING_STARTUP_HOOK');

      expect(missing).toHaveLength(1);
      expect(missing[0].evidence.checkedPaths).toContain('instrumentation.ts');
    });

    it('non-middleware files do not produce NR_MISSING_STARTUP_HOOK', () => {
      const result = analyzeNrServer('src/server/middleware/withAuth.ts');
      const missing = obsOfKind(result, 'NR_MISSING_STARTUP_HOOK');

      expect(missing).toHaveLength(0);
    });
  });
});
