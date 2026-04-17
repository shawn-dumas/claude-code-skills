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
  describe('positive observations (OTel integration)', () => {
    it('detects otelTracer and withChSegment imports', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const imports = obsOfKind(result, 'OTEL_TRACER_IMPORT');

      expect(imports).toHaveLength(2);
      expect(imports[0].evidence.callSite).toContain('@/server/lib/otelTr');
      expect(imports[1].evidence.callSite).toContain('withChSegment');
    });

    it('detects recordError calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const calls = obsOfKind(result, 'OTEL_RECORD_ERROR_CALL');

      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0].evidence.containingFunction).toBe('handleError');
    });

    it('detects setSpanAttributes calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const calls = obsOfKind(result, 'OTEL_SET_ATTRS_CALL');

      expect(calls).toHaveLength(1);
      expect(calls[0].evidence.containingFunction).toBe('setUserContext');
    });

    it('detects withSpan and withChSegment calls', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const spans = obsOfKind(result, 'OTEL_SPAN_CALL');

      expect(spans).toHaveLength(2);
      expect(spans[0].evidence.containingFunction).toBe('queryWithSpan');
      expect(spans[0].evidence.spanName).toBe('DB:fetchUser');
      expect(spans[1].evidence.containingFunction).toBe('queryWithChSegment');
    });
  });

  describe('gap observations (missing OTel integration)', () => {
    it('detects catch block with console.error but no recordError', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_REPORT');

      const noOtel = missing.find(o => o.evidence.containingFunction === 'missingOtelReport');
      expect(noOtel).toBeDefined();
      expect(noOtel!.evidence.errorSink).toBe('console.error');
    });

    it('does not flag catch block that already has recordError', () => {
      const result = analyzeFixture('nr-server-samples.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_REPORT');

      const withOtel = missing.find(o => o.evidence.containingFunction === 'withOtelReport');
      expect(withOtel).toBeUndefined();
    });
  });

  describe('summary', () => {
    it('counts OTel imports, recordError calls, and missing gaps', () => {
      const result = analyzeFixture('nr-server-samples.ts');

      expect(result.summary.otelImports).toBe(2);
      expect(result.summary.recordErrorCalls).toBeGreaterThanOrEqual(1);
      expect(result.summary.setAttrsCalls).toBe(1);
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
    it('withErrorHandler.ts detects recordError calls (OTel migration complete)', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const recordErrorObs = obsOfKind(result, 'OTEL_RECORD_ERROR_CALL');

      expect(recordErrorObs.length).toBeGreaterThanOrEqual(1);
    });

    it('withAuth.ts detects setSpanAttributes calls (OTel migration complete)', () => {
      const result = analyzeNrServer('src/server/middleware/withAuth.ts');
      const setAttrs = obsOfKind(result, 'OTEL_SET_ATTRS_CALL');

      expect(setAttrs).toHaveLength(1);
    });

    it('withErrorHandler.ts detects otelTracer import', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const imports = obsOfKind(result, 'OTEL_TRACER_IMPORT');

      expect(imports.length).toBeGreaterThanOrEqual(1);
    });

    it('withErrorHandler.ts does not report NR_MISSING_STARTUP_HOOK (instrumentation.ts exists)', () => {
      const result = analyzeNrServer('src/server/middleware/withErrorHandler.ts');
      const missing = obsOfKind(result, 'NR_MISSING_STARTUP_HOOK');

      expect(missing).toHaveLength(0);
    });

    it('non-middleware files do not produce NR_MISSING_STARTUP_HOOK', () => {
      const result = analyzeNrServer('src/server/middleware/withAuth.ts');
      const missing = obsOfKind(result, 'NR_MISSING_STARTUP_HOOK');

      expect(missing).toHaveLength(0);
    });
  });
});
