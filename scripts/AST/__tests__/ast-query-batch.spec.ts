import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONTAINER = 'src/ui/page_blocks/dashboard/ui/InsightsFilters/InsightsFiltersContainer.tsx';
const FIXTURE = path.join(__dirname, 'fixtures/branch-classification-samples.tsx');

function runBatch(queryTypes: string, filePath: string, flags: string[] = []): unknown {
  const result = execFileSync(
    'node',
    ['--import', 'tsx', 'scripts/AST/ast-query.ts', 'batch', queryTypes, filePath, '--no-cache', ...flags],
    { encoding: 'utf-8', cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 },
  );
  return JSON.parse(result) as unknown;
}

function getFileResult(output: unknown, filePath: string): Record<string, unknown> {
  const results = output as Record<string, Record<string, unknown>>;
  // Try relative path as-is, or resolve from fixtures
  const key = Object.keys(results).find(k => k.includes(path.basename(filePath)));
  expect(
    key,
    `Expected file key containing ${path.basename(filePath)} in ${JSON.stringify(Object.keys(results))}`,
  ).toBeDefined();
  return results[key!];
}

describe('ast-query batch mode', () => {
  describe('observation tools', () => {
    it('returns hook observations for a single observation query', () => {
      const output = runBatch('hooks', CONTAINER);
      const file = getFileResult(output, CONTAINER);

      expect(file.hooks).toBeDefined();
      const hooks = file.hooks as { count: number; observations: unknown[] };
      expect(hooks.count).toBeGreaterThan(0);
      expect(hooks.observations.length).toBeGreaterThan(0);
    });

    it('returns results for multiple observation queries', () => {
      const output = runBatch('hooks,complexity', CONTAINER);
      const file = getFileResult(output, CONTAINER);

      expect(file.hooks).toBeDefined();
      expect(file.complexity).toBeDefined();
    });

    it('filters by --kind when route specifies one', () => {
      // 'hooks' route has --kind HOOK_CALL, so results should only have HOOK_CALL observations
      const output = runBatch('hooks', CONTAINER);
      const file = getFileResult(output, CONTAINER);
      const hooks = file.hooks as { count: number; observations: { kind: string }[] };

      for (const obs of hooks.observations) {
        expect(obs.kind).toBe('HOOK_CALL');
      }
    });
  });

  describe('interpreters', () => {
    it('returns branch classification assessments', () => {
      const output = runBatch('interpret-branches', FIXTURE);
      const file = getFileResult(output, FIXTURE);

      expect(file['interpret-branches']).toBeDefined();
      const result = file['interpret-branches'] as { assessments: { kind: string }[] };
      expect(result.assessments.length).toBeGreaterThan(0);

      const kinds = result.assessments.map(a => a.kind);
      expect(kinds).toContain('TYPE_DISPATCH');
      expect(kinds).toContain('NULL_GUARD');
    });

    it('returns hook role assessments', () => {
      const output = runBatch('interpret-hooks', CONTAINER);
      const file = getFileResult(output, CONTAINER);

      expect(file['interpret-hooks']).toBeDefined();
      const result = file['interpret-hooks'] as { assessments: { kind: string }[] };
      expect(result.assessments.length).toBeGreaterThan(0);
    });

    it('returns ownership classification', () => {
      const output = runBatch('interpret-ownership', CONTAINER);
      const file = getFileResult(output, CONTAINER);

      expect(file['interpret-ownership']).toBeDefined();
      const result = file['interpret-ownership'] as { assessments: { kind: string }[] };
      expect(result.assessments.length).toBeGreaterThan(0);

      const kinds = result.assessments.map(a => a.kind);
      expect(kinds).toContain('CONTAINER');
    });

    it('returns effect classification', () => {
      const presFile = 'scripts/AST/__tests__/fixtures/component-with-effects.tsx';
      const output = runBatch('interpret-effects', presFile);
      const file = getFileResult(output, presFile);

      expect(file['interpret-effects']).toBeDefined();
      const result = file['interpret-effects'] as { assessments: { kind: string }[] };
      expect(result.assessments.length).toBeGreaterThan(0);
    });
  });

  describe('mixed observation + interpreter', () => {
    it('returns both observation and interpreter results in one call', () => {
      const output = runBatch('hooks,complexity,interpret-branches,interpret-hooks', CONTAINER);
      const file = getFileResult(output, CONTAINER);

      // Observation results
      expect(file.hooks).toBeDefined();
      expect(file.complexity).toBeDefined();

      // Interpreter results
      expect(file['interpret-branches']).toBeDefined();
      expect(file['interpret-hooks']).toBeDefined();
    });
  });

  describe('real-world ground truth: InsightsFiltersContainer', () => {
    it('branch classification shows exactly 1 TYPE_DISPATCH', () => {
      const output = runBatch('interpret-branches', CONTAINER);
      const file = getFileResult(output, CONTAINER);
      const result = file['interpret-branches'] as { assessments: { kind: string; subject: { line: number } }[] };

      const typeDispatches = result.assessments.filter(a => a.kind === 'TYPE_DISPATCH');
      expect(typeDispatches).toHaveLength(1);
      expect(typeDispatches[0].subject.line).toBe(132);
    });

    it('ownership classifies container as CONTAINER with high confidence', () => {
      const output = runBatch('interpret-ownership', CONTAINER);
      const file = getFileResult(output, CONTAINER);
      const result = file['interpret-ownership'] as {
        assessments: { kind: string; confidence: string; subject: { symbol: string } }[];
      };

      const containerAssessment = result.assessments.find(a => a.subject.symbol === 'InsightsFiltersContainer');
      expect(containerAssessment).toBeDefined();
      expect(containerAssessment!.kind).toBe('CONTAINER');
      expect(containerAssessment!.confidence).toBe('high');
    });

    it('hooks count matches expected (13 hook calls)', () => {
      const output = runBatch('hooks', CONTAINER);
      const file = getFileResult(output, CONTAINER);
      const hooks = file.hooks as { count: number };
      expect(hooks.count).toBe(13);
    });
  });

  describe('error handling', () => {
    it('reports error for non-existent file', () => {
      const output = runBatch('hooks', 'src/nonexistent/file.tsx');
      const results = output as Record<string, unknown>;
      expect(Object.keys(results)).toHaveLength(0);
    });
  });
});
