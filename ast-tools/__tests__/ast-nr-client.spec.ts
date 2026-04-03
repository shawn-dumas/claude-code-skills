import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeNrClient, analyzeNrClientDirectory } from '../ast-nr-client';
import type { NrClientAnalysis, NrClientObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): NrClientAnalysis {
  return analyzeNrClient(fixturePath(name));
}

function obsOfKind(analysis: NrClientAnalysis, kind: NrClientObservationKind) {
  return analysis.observations.filter(o => o.kind === kind);
}

describe('ast-nr-client', () => {
  describe('positive observations (existing NR integration)', () => {
    it('detects NREUM.setPageViewName calls', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const nreum = obsOfKind(result, 'NR_NREUM_CALL');

      const pageView = nreum.find(o => o.evidence.nreumMethod === 'setPageViewName');
      expect(pageView).toBeDefined();
      expect(pageView!.evidence.containingFunction).toBe('RouteTracker');
    });

    it('detects NREUM.addPageAction calls', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const nreum = obsOfKind(result, 'NR_NREUM_CALL');

      const pageAction = nreum.find(o => o.evidence.nreumMethod === 'addPageAction');
      expect(pageAction).toBeDefined();
    });

    it('detects reportErrorToNewRelic wrapper calls', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const reports = obsOfKind(result, 'NR_REPORT_ERROR_CALL');

      expect(reports.length).toBeGreaterThanOrEqual(1);
      expect(reports[0].evidence.wrapperFunction).toBe('reportErrorToNewRelic');
    });

    it('detects monitorApiCall wrapper calls', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const monitors = obsOfKind(result, 'NR_MONITOR_API_CALL');

      expect(monitors.length).toBeGreaterThanOrEqual(1);
      expect(monitors[0].evidence.wrapperFunction).toBe('monitorApiCall');
    });

    it('detects NewRelicRouteTracker JSX usage', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const trackers = obsOfKind(result, 'NR_ROUTE_TRACKER');

      expect(trackers).toHaveLength(1);
      expect(trackers[0].evidence.componentName).toBe('NewRelicRouteTracker');
    });
  });

  describe('gap observations (missing NR integration)', () => {
    it('detects catch block with console.error but no NR reporting', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_HANDLER');

      // NoNrInCatch has console.error without NR
      const noNr = missing.find(o => o.evidence.containingFunction === 'NoNrInCatch');
      expect(noNr).toBeDefined();
    });

    it('does not flag catch block that already has NR reporting', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_HANDLER');

      // WithNrInCatch has both console.error AND reportErrorToNewRelic
      const withNr = missing.find(o => o.evidence.containingFunction === 'WithNrInCatch');
      expect(withNr).toBeUndefined();
    });

    it('detects componentDidCatch without NR', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_HANDLER');

      const didCatch = missing.find(o => o.evidence.containingFunction === 'componentDidCatch');
      expect(didCatch).toBeDefined();
    });

    it('does not flag componentDidCatch that reports to NR', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_HANDLER');

      // ErrorBoundaryWithNr calls reportErrorToNewRelic in componentDidCatch
      // There should only be one componentDidCatch missing handler (the one without NR)
      const didCatchMissing = missing.filter(o => o.evidence.containingFunction === 'componentDidCatch');
      expect(didCatchMissing).toHaveLength(1);
    });
  });

  describe('tracer misuse', () => {
    it('detects createTracer callback referencing pre-started async work', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const misuse = obsOfKind(result, 'NR_TRACER_MISUSE');

      expect(misuse).toHaveLength(1);
      expect(misuse[0].evidence.containingFunction).toBe('BadTracerPattern');
      expect(misuse[0].evidence.preStartedVariable).toBe('resultPromise');
    });

    it('does not flag correct tracer pattern with async work inside callback', () => {
      const result = analyzeFixture('nr-client-samples.tsx');
      const misuse = obsOfKind(result, 'NR_TRACER_MISUSE');

      const good = misuse.find(o => o.evidence.containingFunction === 'GoodTracerPattern');
      expect(good).toBeUndefined();
    });
  });

  describe('summary', () => {
    it('counts NREUM calls, report calls, and missing gaps', () => {
      const result = analyzeFixture('nr-client-samples.tsx');

      expect(result.summary.nreumCalls).toBeGreaterThanOrEqual(2);
      expect(result.summary.reportErrorCalls).toBeGreaterThanOrEqual(1);
      expect(result.summary.monitorApiCalls).toBeGreaterThanOrEqual(1);
      expect(result.summary.missingCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('directory analysis', () => {
    it('analyzes a directory and returns results', () => {
      const results = analyzeNrClientDirectory(FIXTURES_DIR);

      const fixture = results.find(r => r.filePath.includes('nr-client-samples'));
      expect(fixture).toBeDefined();
      expect(fixture!.observations.length).toBeGreaterThan(0);
    });
  });

  describe('real-world smoke tests', () => {
    it('errorTracking.ts has 1 NREUM noticeError call', () => {
      const result = analyzeNrClient('src/shared/utils/newrelic/errorTracking.ts');
      const nreum = obsOfKind(result, 'NR_NREUM_CALL');

      expect(nreum).toHaveLength(1);
      expect(nreum[0].evidence.nreumMethod).toBe('noticeError');
    });

    it('monitorApiCall.ts has 4 NREUM calls', () => {
      const result = analyzeNrClient('src/shared/utils/newrelic/monitorApiCall.ts');
      const nreum = obsOfKind(result, 'NR_NREUM_CALL');

      expect(nreum).toHaveLength(4);
    });

    it('reactQueryIntegration.ts has 2 reportErrorToNewRelic calls', () => {
      const result = analyzeNrClient('src/shared/utils/newrelic/reactQueryIntegration.ts');
      const reports = obsOfKind(result, 'NR_REPORT_ERROR_CALL');

      expect(reports).toHaveLength(2);
    });

    it('NewRelicRouteTracker.tsx has 2 NREUM calls (setPageViewName)', () => {
      const result = analyzeNrClient('src/ui/providers/NewRelicRouteTracker.tsx');
      const nreum = obsOfKind(result, 'NR_NREUM_CALL');

      expect(nreum).toHaveLength(2);
      expect(nreum.every(o => o.evidence.nreumMethod === 'setPageViewName')).toBe(true);
    });

    it('ErrorBoundary.tsx has 1 reportErrorToNewRelic call', () => {
      const result = analyzeNrClient('src/shared/ui/ErrorBoundary/ErrorBoundary.tsx');
      const reports = obsOfKind(result, 'NR_REPORT_ERROR_CALL');

      expect(reports).toHaveLength(1);
    });

    it('fetchApi.ts has 1 monitorApiCall call', () => {
      const result = analyzeNrClient('src/shared/lib/fetchApi/fetchApi.ts');
      const monitors = obsOfKind(result, 'NR_MONITOR_API_CALL');

      expect(monitors).toHaveLength(1);
    });

    it('NR utility files are excluded from NR_MISSING_ERROR_HANDLER', () => {
      const result = analyzeNrClient('src/shared/utils/newrelic/errorTracking.ts');
      const missing = obsOfKind(result, 'NR_MISSING_ERROR_HANDLER');

      expect(missing).toHaveLength(0);
    });

    it('monitorApiCall.ts has 1 NR_TRACER_MISUSE (pre-started resultPromise)', () => {
      const result = analyzeNrClient('src/shared/utils/newrelic/monitorApiCall.ts');
      const misuse = obsOfKind(result, 'NR_TRACER_MISUSE');

      expect(misuse).toHaveLength(1);
      expect(misuse[0].evidence.preStartedVariable).toBe('resultPromise');
    });

    it('_app.tsx does not produce NR_MISSING_ROUTE_TRACK (Providers.tsx has tracker)', () => {
      const result = analyzeNrClient('src/pages/_app.tsx');
      const missing = obsOfKind(result, 'NR_MISSING_ROUTE_TRACK');

      expect(missing).toHaveLength(0);
    });
  });
});
