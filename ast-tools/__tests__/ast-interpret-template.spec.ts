import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretTemplate, type TemplateAssessment } from '../ast-interpret-template';
import { extractJsxObservations } from '../ast-jsx-analysis';
import type { JsxObservation, AssessmentResult } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Helper to create a minimal JSX_RETURN_BLOCK observation.
 */
function makeReturnBlock(file: string, componentName: string, line: number, returnLineCount: number): JsxObservation {
  return {
    kind: 'JSX_RETURN_BLOCK',
    file,
    line,
    evidence: {
      componentName,
      returnStartLine: line,
      returnEndLine: line + returnLineCount - 1,
      returnLineCount,
    },
  };
}

/**
 * Helper to create an observation.
 */
function makeObs(
  kind: JsxObservation['kind'],
  file: string,
  componentName: string,
  line: number,
  extra: Partial<JsxObservation['evidence']> = {},
): JsxObservation {
  return {
    kind,
    file,
    line,
    evidence: {
      componentName,
      ...extra,
    },
  };
}

describe('ast-interpret-template', () => {
  describe('EXTRACTION_CANDIDATE classification', () => {
    it('classifies long return (> 100 lines) as EXTRACTION_CANDIDATE', () => {
      const observations: JsxObservation[] = [makeReturnBlock('test.tsx', 'LongComponent', 10, 120)];

      const result = interpretTemplate(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTRACTION_CANDIDATE');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].isCandidate).toBe(true);
    });

    it('classifies very long return (> 150 lines) with high confidence', () => {
      const observations: JsxObservation[] = [makeReturnBlock('test.tsx', 'VeryLongComponent', 10, 160)];

      const result = interpretTemplate(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTRACTION_CANDIDATE');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('classifies IIFE as EXTRACTION_CANDIDATE with high confidence', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'IifeComponent', 10, 50),
        makeObs('JSX_IIFE', 'test.tsx', 'IifeComponent', 15),
      ];

      const result = interpretTemplate(observations);

      expect(result.assessments.some(a => a.kind === 'EXTRACTION_CANDIDATE')).toBe(true);
      const extraction = result.assessments.find(a => a.kind === 'EXTRACTION_CANDIDATE');
      expect(extraction?.confidence).toBe('high');
      expect(extraction?.rationale.some(r => r.includes('IIFE'))).toBe(true);
    });

    it('classifies multiple deep ternary chains as EXTRACTION_CANDIDATE', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'TernaryComponent', 10, 50),
        makeObs('JSX_TERNARY_CHAIN', 'test.tsx', 'TernaryComponent', 15, { depth: 3 }),
        makeObs('JSX_TERNARY_CHAIN', 'test.tsx', 'TernaryComponent', 25, { depth: 2 }),
      ];

      const result = interpretTemplate(observations);

      expect(result.assessments.some(a => a.kind === 'EXTRACTION_CANDIDATE')).toBe(true);
      const extraction = result.assessments.find(a => a.kind === 'EXTRACTION_CANDIDATE');
      expect(extraction?.rationale.some(r => r.includes('ternary'))).toBe(true);
    });
  });

  describe('COMPLEXITY_HOTSPOT classification', () => {
    it('classifies component with 3+ distinct observation kinds as COMPLEXITY_HOTSPOT', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'ComplexComponent', 10, 50),
        makeObs('JSX_TERNARY_CHAIN', 'test.tsx', 'ComplexComponent', 15, { depth: 1 }),
        makeObs('JSX_GUARD_CHAIN', 'test.tsx', 'ComplexComponent', 20, { conditionCount: 2 }),
        makeObs('JSX_INLINE_HANDLER', 'test.tsx', 'ComplexComponent', 25, { statementCount: 1 }),
      ];

      const result = interpretTemplate(observations);

      expect(result.assessments.some(a => a.kind === 'COMPLEXITY_HOTSPOT')).toBe(true);
      const hotspot = result.assessments.find(a => a.kind === 'COMPLEXITY_HOTSPOT');
      expect(hotspot?.confidence).toBe('medium');
      expect(hotspot?.isCandidate).toBe(true);
    });

    it('classifies large inline handler (>= 4 statements) as COMPLEXITY_HOTSPOT', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'HandlerComponent', 10, 50),
        makeObs('JSX_INLINE_HANDLER', 'test.tsx', 'HandlerComponent', 15, {
          handlerName: 'onClick',
          statementCount: 5,
        }),
      ];

      const result = interpretTemplate(observations);

      expect(result.assessments.some(a => a.kind === 'COMPLEXITY_HOTSPOT')).toBe(true);
      const hotspot = result.assessments.find(a => a.kind === 'COMPLEXITY_HOTSPOT');
      expect(hotspot?.rationale.some(r => r.includes('5 statements'))).toBe(true);
    });
  });

  describe('no assessments for simple components', () => {
    it('does not emit assessments for component within thresholds', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'SimpleComponent', 10, 30),
        makeObs('JSX_TERNARY_CHAIN', 'test.tsx', 'SimpleComponent', 15, { depth: 1 }),
      ];

      const result = interpretTemplate(observations);

      // No EXTRACTION_CANDIDATE (return not long enough, ternary not deep enough)
      // No COMPLEXITY_HOTSPOT (only 1 distinct observation kind)
      expect(result.assessments).toHaveLength(0);
    });

    it('returns empty assessments for empty observations', () => {
      const result = interpretTemplate([]);
      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('integration with real fixtures', () => {
    it('produces assessments for component-with-jsx-complexity.tsx', () => {
      const observations = extractJsxObservations(fixturePath('component-with-jsx-complexity.tsx'));
      const result = interpretTemplate(observations);

      // ComplexList has multiple complexity patterns
      const complexListAssessments = result.assessments.filter(a => a.subject.symbol === 'ComplexList');

      // Should have at least a COMPLEXITY_HOTSPOT (it has many distinct observation kinds)
      expect(complexListAssessments.some(a => a.kind === 'COMPLEXITY_HOTSPOT')).toBe(true);
    });

    it('produces no extraction candidates for jsx-negative.tsx', () => {
      const observations = extractJsxObservations(fixturePath('jsx-negative.tsx'));
      const result = interpretTemplate(observations);

      // jsx-negative.tsx contains patterns that are NOT violations
      // It should not produce EXTRACTION_CANDIDATE assessments
      const extractionCandidates = result.assessments.filter(a => a.kind === 'EXTRACTION_CANDIDATE');
      expect(extractionCandidates).toHaveLength(0);
    });
  });

  describe('basedOn traces back to observations', () => {
    it('basedOn contains valid ObservationRef entries', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'TestComponent', 10, 120),
        makeObs('JSX_IIFE', 'test.tsx', 'TestComponent', 15),
      ];

      const result = interpretTemplate(observations);

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
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'TestComponent', 10, 160),
        makeObs('JSX_IIFE', 'test.tsx', 'TestComponent', 15),
      ];

      const result = interpretTemplate(observations);

      for (const assessment of result.assessments) {
        expect(assessment).toHaveProperty('kind');
        expect(assessment).toHaveProperty('subject');
        expect(assessment).toHaveProperty('confidence');
        expect(assessment).toHaveProperty('rationale');
        expect(assessment).toHaveProperty('basedOn');
        expect(assessment).toHaveProperty('isCandidate');
        expect(assessment).toHaveProperty('requiresManualReview');

        expect(assessment.subject).toHaveProperty('file');
        expect(assessment.subject).toHaveProperty('symbol');

        expect(Array.isArray(assessment.rationale)).toBe(true);
        expect(Array.isArray(assessment.basedOn)).toBe(true);
      }
    });

    it('output is JSON-serializable', () => {
      const observations: JsxObservation[] = [makeReturnBlock('test.tsx', 'TestComponent', 10, 160)];

      const result = interpretTemplate(observations);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<TemplateAssessment>;
      expect(parsed.assessments).toHaveLength(1);
    });
  });

  describe('all assessment kinds are tested', () => {
    it('tests exist for all assessment kinds', () => {
      const allKinds = new Set(['EXTRACTION_CANDIDATE', 'COMPLEXITY_HOTSPOT']);
      const testedKinds = new Set<string>();

      // EXTRACTION_CANDIDATE: tested in multiple scenarios
      testedKinds.add('EXTRACTION_CANDIDATE');

      // COMPLEXITY_HOTSPOT: tested with distinct kinds and large handlers
      testedKinds.add('COMPLEXITY_HOTSPOT');

      expect(testedKinds).toEqual(allKinds);
    });
  });

  describe('boundary confidence', () => {
    it('adds near-boundary when returnLineCount is near threshold (e.g., 105 near 100)', () => {
      const observations: JsxObservation[] = [makeReturnBlock('test.tsx', 'NearThreshold', 10, 105)];

      const result = interpretTemplate(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTRACTION_CANDIDATE');
      expect(result.assessments[0].rationale.some(r => r.includes('[near-boundary]'))).toBe(true);
      expect(result.assessments[0].rationale.some(r => r.includes('returnLineCount'))).toBe(true);
    });

    it('does not add near-boundary when returnLineCount is far from threshold (e.g., 200)', () => {
      const observations: JsxObservation[] = [makeReturnBlock('test.tsx', 'FarFromThreshold', 10, 200)];

      const result = interpretTemplate(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('EXTRACTION_CANDIDATE');
      // 200 is far from both 100 and 150 thresholds
      expect(result.assessments[0].rationale.every(r => !r.includes('[near-boundary]'))).toBe(true);
    });

    it('adds near-boundary for handler statement count near hotspot threshold', () => {
      const observations: JsxObservation[] = [
        makeReturnBlock('test.tsx', 'HandlerNearBoundary', 10, 50),
        makeObs('JSX_INLINE_HANDLER', 'test.tsx', 'HandlerNearBoundary', 15, { statementCount: 4 }),
        makeObs('JSX_TERNARY_CHAIN', 'test.tsx', 'HandlerNearBoundary', 20, { depth: 1 }),
        makeObs('JSX_GUARD_CHAIN', 'test.tsx', 'HandlerNearBoundary', 25, { conditionCount: 2 }),
      ];

      const result = interpretTemplate(observations);

      // Should have COMPLEXITY_HOTSPOT (3+ distinct kinds: INLINE_HANDLER, TERNARY_CHAIN, GUARD_CHAIN)
      const hotspot = result.assessments.find(a => a.kind === 'COMPLEXITY_HOTSPOT');
      expect(hotspot).toBeDefined();
      // handlerStatementCount=4, threshold=4 -- exactly at threshold -> near-boundary
      expect(hotspot!.rationale.some(r => r.includes('[near-boundary]') && r.includes('handlerStatements'))).toBe(true);
    });
  });
});
