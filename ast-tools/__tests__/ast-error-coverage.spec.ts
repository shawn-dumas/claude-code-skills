import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeErrorCoverage, extractErrorCoverageObservations } from '../ast-error-coverage';
import type { ErrorCoverageAnalysis } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ErrorCoverageAnalysis {
  return analyzeErrorCoverage(fixturePath(name));
}

describe('ast-error-coverage', () => {
  describe('fixture: error-coverage-samples.tsx', () => {
    it('produces observations for query and mutation hooks', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      expect(result.observations.length).toBeGreaterThan(0);
    });

    it('detects QUERY_ERROR_HANDLED when isError is destructured', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const handled = result.observations.filter(o => o.kind === 'QUERY_ERROR_HANDLED');
      expect(handled.length).toBeGreaterThanOrEqual(1);

      const handledObs = handled.find(o => o.evidence.componentName === 'HandledQueryContainer');
      expect(handledObs).toBeDefined();
      expect(handledObs!.evidence.hasIsError).toBe(true);
      expect(handledObs!.evidence.hookName).toBe('useTeamDataQuery');
    });

    it('detects QUERY_ERROR_UNHANDLED when isError is not destructured', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const unhandled = result.observations.filter(o => o.kind === 'QUERY_ERROR_UNHANDLED');
      expect(unhandled.length).toBeGreaterThanOrEqual(1);

      const unhandledObs = unhandled.find(o => o.evidence.componentName === 'UnhandledQueryContainer');
      expect(unhandledObs).toBeDefined();
      expect(unhandledObs!.evidence.hasIsError).toBe(false);
      expect(unhandledObs!.evidence.hookName).toBe('useTeamDataQuery');
    });

    it('detects MUTATION_ERROR_HANDLED when onError is in options', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const handled = result.observations.filter(o => o.kind === 'MUTATION_ERROR_HANDLED');
      expect(handled.length).toBeGreaterThanOrEqual(1);

      const handledObs = handled.find(o => o.evidence.componentName === 'HandledMutationContainer');
      expect(handledObs).toBeDefined();
      expect(handledObs!.evidence.hasOnError).toBe(true);
      expect(handledObs!.evidence.hookName).toBe('useUpdateTeamMutation');
    });

    it('detects MUTATION_ERROR_UNHANDLED when no error handling exists', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const unhandled = result.observations.filter(o => o.kind === 'MUTATION_ERROR_UNHANDLED');
      expect(unhandled.length).toBeGreaterThanOrEqual(1);

      const unhandledObs = unhandled.find(o => o.evidence.componentName === 'UnhandledMutationContainer');
      expect(unhandledObs).toBeDefined();
      expect(unhandledObs!.evidence.hasOnError).toBe(false);
      expect(unhandledObs!.evidence.hasTryCatch).toBe(false);
      expect(unhandledObs!.evidence.hookName).toBe('useDeleteItemMutation');
    });

    it('does not produce observations for PlainComponent (no hooks)', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const plain = result.observations.filter(o => o.evidence.componentName === 'PlainComponent');
      expect(plain).toHaveLength(0);
    });

    it('does not flag useNoErrorQuery (no Query/Mutation suffix pattern match and not in tanstackQueryHooks)', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const noError = result.observations.filter(o => o.evidence.hookName === 'useNoErrorQuery');
      expect(noError).toHaveLength(0);
    });

    it('detects QUERY_ERROR_HANDLED via renamed destructuring (isError: teamError)', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const obs = result.observations.find(o => o.evidence.componentName === 'RenamedErrorContainer');
      expect(obs).toBeDefined();
      expect(obs!.kind).toBe('QUERY_ERROR_HANDLED');
      expect(obs!.evidence.hasIsError).toBe(true);
    });

    it('detects QUERY_ERROR_HANDLED via throwOnError in options', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const obs = result.observations.find(o => o.evidence.componentName === 'ThrowOnErrorContainer');
      expect(obs).toBeDefined();
      expect(obs!.kind).toBe('QUERY_ERROR_HANDLED');
      expect(obs!.evidence.hasThrowOnError).toBe(true);
    });

    it('detects QUERY_ERROR_HANDLED via error (not isError) destructuring', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const obs = result.observations.find(o => o.evidence.componentName === 'ErrorObjectContainer');
      expect(obs).toBeDefined();
      expect(obs!.kind).toBe('QUERY_ERROR_HANDLED');
      expect(obs!.evidence.hasIsError).toBe(true);
    });

    it('detects MUTATION_ERROR_HANDLED via try-catch around mutateAsync', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      const obs = result.observations.find(o => o.evidence.componentName === 'TryCatchMutationContainer');
      expect(obs).toBeDefined();
      expect(obs!.kind).toBe('MUTATION_ERROR_HANDLED');
      expect(obs!.evidence.hasTryCatch).toBe(true);
    });
  });

  describe('summary', () => {
    it('correctly counts handled and unhandled queries and mutations', () => {
      const result = analyzeFixture('error-coverage-samples.tsx');
      expect(result.summary.queriesHandled).toBeGreaterThanOrEqual(1);
      expect(result.summary.queriesUnhandled).toBeGreaterThanOrEqual(1);
      expect(result.summary.mutationsHandled).toBeGreaterThanOrEqual(1);
      expect(result.summary.mutationsUnhandled).toBeGreaterThanOrEqual(1);
      expect(result.summary.queriesTotal).toBe(result.summary.queriesHandled + result.summary.queriesUnhandled);
      expect(result.summary.mutationsTotal).toBe(result.summary.mutationsHandled + result.summary.mutationsUnhandled);
    });
  });

  describe('extractErrorCoverageObservations', () => {
    it('returns an ObservationResult with matching filePath', () => {
      const analysis = analyzeFixture('error-coverage-samples.tsx');
      const result = extractErrorCoverageObservations(analysis);
      expect(result.filePath).toBe(analysis.filePath);
      expect(result.observations).toBe(analysis.observations);
    });
  });
});
