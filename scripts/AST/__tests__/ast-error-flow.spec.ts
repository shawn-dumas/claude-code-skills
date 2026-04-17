import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeErrorFlow, analyzeErrorFlowDirectory } from '../ast-error-flow';
import type { ErrorFlowAnalysis, ErrorSinkClassification } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ErrorFlowAnalysis {
  return analyzeErrorFlow(fixturePath(name));
}

function sinksOfType(analysis: ErrorFlowAnalysis, sink: ErrorSinkClassification) {
  return analysis.observations.filter(o => o.evidence.sink === sink);
}

describe('ast-error-flow', () => {
  describe('ERROR_SINK_TYPE', () => {
    it('detects console.error sink', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const consoleSinks = sinksOfType(result, 'console');

      expect(consoleSinks.length).toBeGreaterThanOrEqual(1);
      const first = consoleSinks[0];
      expect(first.evidence.containingFunction).toBe('handleWithConsole');
      expect(first.evidence.sinkExpression).toContain('console.error');
    });

    it('detects NR report sink via wrapper function', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const nrSinks = sinksOfType(result, 'newrelic');

      expect(nrSinks.length).toBeGreaterThanOrEqual(1);
      const first = nrSinks[0];
      expect(first.evidence.containingFunction).toBe('handleWithNr');
      expect(first.evidence.sinkExpression).toContain('reportErrorToNewRelic');
    });

    it('detects rethrow sink', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const rethrows = sinksOfType(result, 'rethrow');

      expect(rethrows.length).toBeGreaterThanOrEqual(1);
      const rethrow = rethrows.find(r => r.evidence.containingFunction === 'handleWithRethrow');
      expect(rethrow).toBeDefined();
      expect(rethrow!.evidence.sinkExpression).toContain('throw');
    });

    it('detects swallowed (empty catch block)', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const swallowed = sinksOfType(result, 'swallowed');

      const empty = swallowed.find(s => s.evidence.containingFunction === 'handleSwallowed');
      expect(empty).toBeDefined();
      expect(empty!.evidence.sinkExpression).toBe('(empty catch block)');
    });

    it('detects response sink (BFF handler pattern)', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const responseSinks = sinksOfType(result, 'response');

      const handler = responseSinks.find(r => r.evidence.containingFunction === 'handleWithResponse');
      expect(handler).toBeDefined();
      expect(handler!.evidence.sinkExpression).toContain('res.status');
    });

    it('detects callback sink', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const callbackSinks = sinksOfType(result, 'callback');

      expect(callbackSinks.length).toBeGreaterThanOrEqual(1);
      expect(callbackSinks[0].evidence.containingFunction).toBe('handleWithCallback');
    });

    it('marks multiple sinks with hasMultipleSinks', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const multiSinks = result.observations.filter(o => o.evidence.containingFunction === 'handleWithMultiple');

      expect(multiSinks.length).toBe(2);
      for (const sink of multiSinks) {
        expect(sink.evidence.hasMultipleSinks).toBe(true);
      }
    });

    it('detects NREUM.noticeError as newrelic sink', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const nrSinks = sinksOfType(result, 'newrelic');

      const nreum = nrSinks.find(s => s.evidence.containingFunction === 'handleWithNreumDirect');
      expect(nreum).toBeDefined();
    });

    it('detects swallowed catch with assignment only (no sink)', () => {
      const result = analyzeFixture('error-flow-samples.ts');
      const swallowed = sinksOfType(result, 'swallowed');

      const assignment = swallowed.find(s => s.evidence.containingFunction === 'handleSwallowedWithAssignment');
      expect(assignment).toBeDefined();
    });
  });

  describe('summary', () => {
    it('computes sink counts correctly', () => {
      const result = analyzeFixture('error-flow-samples.ts');

      expect(result.summary.console).toBeGreaterThanOrEqual(1);
      expect(result.summary.newrelic).toBeGreaterThanOrEqual(2);
      expect(result.summary.rethrow).toBeGreaterThanOrEqual(1);
      expect(result.summary.swallowed).toBeGreaterThanOrEqual(2);
      expect(result.summary.response).toBeGreaterThanOrEqual(1);
      expect(result.summary.callback).toBeGreaterThanOrEqual(1);
    });
  });

  describe('directory analysis', () => {
    it('analyzes a directory and returns results', () => {
      const results = analyzeErrorFlowDirectory(FIXTURES_DIR);

      // The fixture file should appear in results
      const fixture = results.find(r => r.filePath.includes('error-flow-samples'));
      expect(fixture).toBeDefined();
      expect(fixture!.observations.length).toBeGreaterThan(0);
    });
  });

  describe('real-world smoke tests', () => {
    it('withErrorHandler has 3 console + 0 newrelic + 6 response sinks after otel migration', () => {
      // Post-otel reality (PR #1377): newrelic.noticeError calls in
      // withErrorHandler.ts were replaced with recordError from otelTracer.
      // ast-error-flow does not yet classify recordError as a distinct sink
      // type, so the newrelic count dropped to 0 and no otel observations
      // are emitted. Total dropped from 12 -> 9. Follow-up (out of scope for
      // PR #1400): add 'otel' to ErrorSinkClassification and classify
      // recordError / span.recordException as otel sinks.
      const result = analyzeErrorFlow('src/server/middleware/withErrorHandler.ts');
      const consoleSinks = sinksOfType(result, 'console');
      const newrelicSinks = sinksOfType(result, 'newrelic');
      const responseSinks = sinksOfType(result, 'response');

      expect(consoleSinks).toHaveLength(3);
      expect(newrelicSinks).toHaveLength(0);
      expect(responseSinks).toHaveLength(6);
      expect(result.observations).toHaveLength(9);
    });

    it('errorTracking.ts has console sink (NR fallback)', () => {
      const result = analyzeErrorFlow('src/shared/utils/newrelic/errorTracking.ts');
      const consoleSinks = sinksOfType(result, 'console');

      expect(consoleSinks.length).toBeGreaterThanOrEqual(1);
      expect(consoleSinks[0].evidence.containingFunction).toBe('reportErrorToNewRelic');
    });

    it('monitorApiCall.ts has console sink (NR monitoring fallback)', () => {
      const result = analyzeErrorFlow('src/shared/utils/newrelic/monitorApiCall.ts');
      const consoleSinks = sinksOfType(result, 'console');

      expect(consoleSinks.length).toBeGreaterThanOrEqual(1);
      expect(consoleSinks[0].evidence.containingFunction).toBe('monitorApiCall');
    });
  });
});
