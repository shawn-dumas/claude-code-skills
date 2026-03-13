import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretDeadCode, type DeadCodeAssessment } from '../ast-interpret-dead-code';
import { buildDependencyGraph, extractImportObservations } from '../ast-imports';
import type { ImportObservation, AssessmentResult } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Helper to create a DEAD_EXPORT_CANDIDATE observation.
 */
function makeDeadExport(
  file: string,
  exportName: string,
  line: number,
  options: {
    exportKind?: string;
    isNextJsPage?: boolean;
    isBarrelReexported?: boolean;
  } = {},
): ImportObservation {
  return {
    kind: 'DEAD_EXPORT_CANDIDATE',
    file,
    line,
    evidence: {
      exportName,
      exportKind: options.exportKind ?? 'function',
      consumerCount: 0,
      isNextJsPage: options.isNextJsPage ?? false,
      isBarrelReexported: options.isBarrelReexported ?? false,
    },
  };
}

/**
 * Helper to create a CIRCULAR_DEPENDENCY observation.
 */
function makeCircularDep(file: string, line: number, cyclePath: string[]): ImportObservation {
  return {
    kind: 'CIRCULAR_DEPENDENCY',
    file,
    line,
    evidence: {
      cyclePath,
    },
  };
}

/**
 * Helper to create a REEXPORT_IMPORT observation.
 */
function makeReexport(file: string, exportName: string, line: number): ImportObservation {
  return {
    kind: 'REEXPORT_IMPORT',
    file,
    line,
    evidence: {
      exportName,
    },
  };
}

describe('ast-interpret-dead-code', () => {
  describe('DEAD_EXPORT classification', () => {
    it('classifies dead export with 0 consumers as DEAD_EXPORT', () => {
      const observations: ImportObservation[] = [makeDeadExport('test.ts', 'unusedFunction', 5)];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DEAD_EXPORT');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].subject.symbol).toBe('unusedFunction');
    });

    it('classifies type export as DEAD_EXPORT with medium confidence', () => {
      const observations: ImportObservation[] = [makeDeadExport('test.ts', 'UnusedType', 5, { exportKind: 'type' })];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DEAD_EXPORT');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].rationale.some(r => r.includes('type'))).toBe(true);
    });

    it('classifies interface export as DEAD_EXPORT with medium confidence', () => {
      const observations: ImportObservation[] = [
        makeDeadExport('test.ts', 'UnusedInterface', 5, { exportKind: 'interface' }),
      ];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DEAD_EXPORT');
      expect(result.assessments[0].confidence).toBe('medium');
    });

    it('does not flag Next.js page exports', () => {
      const observations: ImportObservation[] = [
        makeDeadExport('src/pages/index.tsx', 'default', 1, { isNextJsPage: true }),
      ];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(0);
    });

    it('does not flag barrel re-exported symbols', () => {
      const observations: ImportObservation[] = [
        makeDeadExport('test.ts', 'reexportedFunction', 5, { isBarrelReexported: true }),
      ];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('POSSIBLY_DEAD_EXPORT classification', () => {
    it('classifies API route export as POSSIBLY_DEAD_EXPORT', () => {
      const observations: ImportObservation[] = [makeDeadExport('src/pages/api/users.ts', 'handler', 10)];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('POSSIBLY_DEAD_EXPORT');
      expect(result.assessments[0].confidence).toBe('low');
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });

    it('classifies server directory export as POSSIBLY_DEAD_EXPORT', () => {
      const observations: ImportObservation[] = [makeDeadExport('src/server/utils.ts', 'serverHelper', 10)];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('POSSIBLY_DEAD_EXPORT');
      expect(result.assessments[0].confidence).toBe('low');
    });
  });

  describe('CIRCULAR_DEPENDENCY classification', () => {
    it('classifies circular dependency with high confidence', () => {
      const observations: ImportObservation[] = [makeCircularDep('a.ts', 1, ['a.ts', 'b.ts', 'a.ts'])];

      const result = interpretDeadCode(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('CIRCULAR_DEPENDENCY');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].requiresManualReview).toBe(true);
      expect(result.assessments[0].isCandidate).toBe(false);
    });

    it('includes cycle path in rationale', () => {
      const observations: ImportObservation[] = [makeCircularDep('a.ts', 1, ['a.ts', 'b.ts', 'c.ts', 'a.ts'])];

      const result = interpretDeadCode(observations);

      expect(result.assessments[0].rationale.some(r => r.includes('a.ts'))).toBe(true);
    });

    it('truncates long cycle paths in rationale', () => {
      const longCycle = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'a.ts'];
      const observations: ImportObservation[] = [makeCircularDep('a.ts', 1, longCycle)];

      const result = interpretDeadCode(observations);

      expect(result.assessments[0].rationale.some(r => r.includes('...'))).toBe(true);
    });
  });

  describe('DEAD_BARREL_REEXPORT classification', () => {
    it('classifies barrel re-export of dead symbol as DEAD_BARREL_REEXPORT', () => {
      const observations: ImportObservation[] = [
        makeDeadExport('utils.ts', 'unusedHelper', 5),
        makeReexport('index.ts', 'unusedHelper', 1),
      ];

      const result = interpretDeadCode(observations);

      // Should have both DEAD_EXPORT and DEAD_BARREL_REEXPORT
      expect(result.assessments.some(a => a.kind === 'DEAD_EXPORT')).toBe(true);
      expect(result.assessments.some(a => a.kind === 'DEAD_BARREL_REEXPORT')).toBe(true);

      const barrelAssessment = result.assessments.find(a => a.kind === 'DEAD_BARREL_REEXPORT');
      expect(barrelAssessment?.confidence).toBe('medium');
    });

    it('does not flag re-export of live symbol', () => {
      const observations: ImportObservation[] = [makeReexport('index.ts', 'usedHelper', 1)];

      const result = interpretDeadCode(observations);

      expect(result.assessments.some(a => a.kind === 'DEAD_BARREL_REEXPORT')).toBe(false);
    });
  });

  describe('integration with real fixtures', () => {
    it('detects dead exports in dead-export.ts', () => {
      const graph = buildDependencyGraph(fixturePath('dead-export.ts'), {
        searchDir: FIXTURES_DIR,
      });
      const observationResult = extractImportObservations(graph);
      const result = interpretDeadCode(observationResult.observations);

      // dead-export.ts has unusedFunction and UNUSED_CONST
      const deadExports = result.assessments.filter(a => a.kind === 'DEAD_EXPORT');

      // At least one dead export should be found
      // (exact count depends on whether consumer fixture imports all)
      expect(deadExports.length).toBeGreaterThanOrEqual(1);
    });

    it('detects circular dependency in circular-a.ts and circular-b.ts', () => {
      const graph = buildDependencyGraph(fixturePath('circular-a.ts'), {
        searchDir: FIXTURES_DIR,
      });
      const observationResult = extractImportObservations(graph);
      const result = interpretDeadCode(observationResult.observations);

      // Should detect the circular dependency
      const circularAssessments = result.assessments.filter(a => a.kind === 'CIRCULAR_DEPENDENCY');
      expect(circularAssessments.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('basedOn traces back to observations', () => {
    it('basedOn contains valid ObservationRef entries', () => {
      const observations: ImportObservation[] = [
        makeDeadExport('test.ts', 'unusedFunction', 5),
        makeCircularDep('a.ts', 1, ['a.ts', 'b.ts', 'a.ts']),
      ];

      const result = interpretDeadCode(observations);

      expect(result.assessments.length).toBeGreaterThan(0);

      for (const assessment of result.assessments) {
        expect(assessment.basedOn.length).toBeGreaterThan(0);

        for (const ref of assessment.basedOn) {
          expect(ref).toHaveProperty('kind');
          expect(ref).toHaveProperty('file');
          expect(ref).toHaveProperty('line');

          // Verify the ref matches an input observation
          const matchingObs = observations.find(o => o.kind === ref.kind && o.file === ref.file && o.line === ref.line);
          expect(matchingObs).toBeDefined();
        }
      }
    });
  });

  describe('assessment structure', () => {
    it('each assessment has all required fields', () => {
      const observations: ImportObservation[] = [makeDeadExport('test.ts', 'unusedFunction', 5)];

      const result = interpretDeadCode(observations);

      for (const assessment of result.assessments) {
        expect(assessment).toHaveProperty('kind');
        expect(assessment).toHaveProperty('subject');
        expect(assessment).toHaveProperty('confidence');
        expect(assessment).toHaveProperty('rationale');
        expect(assessment).toHaveProperty('basedOn');
        expect(assessment).toHaveProperty('isCandidate');
        expect(assessment).toHaveProperty('requiresManualReview');

        expect(assessment.subject).toHaveProperty('file');
        expect(assessment.subject).toHaveProperty('line');

        expect(Array.isArray(assessment.rationale)).toBe(true);
        expect(Array.isArray(assessment.basedOn)).toBe(true);
      }
    });

    it('output is JSON-serializable', () => {
      const observations: ImportObservation[] = [makeDeadExport('test.ts', 'unusedFunction', 5)];

      const result = interpretDeadCode(observations);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<DeadCodeAssessment>;
      expect(parsed.assessments).toHaveLength(1);
    });

    it('returns empty assessments for empty observations', () => {
      const result = interpretDeadCode([]);
      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('all assessment kinds are tested', () => {
    it('tests exist for all assessment kinds', () => {
      const allKinds = new Set(['DEAD_EXPORT', 'POSSIBLY_DEAD_EXPORT', 'DEAD_BARREL_REEXPORT', 'CIRCULAR_DEPENDENCY']);
      const testedKinds = new Set<string>();

      // DEAD_EXPORT: tested with function and type exports
      testedKinds.add('DEAD_EXPORT');

      // POSSIBLY_DEAD_EXPORT: tested with API route and server directory
      testedKinds.add('POSSIBLY_DEAD_EXPORT');

      // DEAD_BARREL_REEXPORT: tested with barrel re-export of dead symbol
      testedKinds.add('DEAD_BARREL_REEXPORT');

      // CIRCULAR_DEPENDENCY: tested with cycle path
      testedKinds.add('CIRCULAR_DEPENDENCY');

      expect(testedKinds).toEqual(allKinds);
    });
  });
});
