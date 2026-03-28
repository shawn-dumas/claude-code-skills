import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretBranchClassification } from '../ast-interpret-branch-classification';
import { analyzeComplexity, extractComplexityObservations } from '../ast-complexity';
import type { ComplexityObservation, BranchClassificationAssessment } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Run the full pipeline on a fixture: complexity analysis -> observations -> interpretation.
 */
function analyzeFixture(name: string): BranchClassificationAssessment[] {
  const fp = fixturePath(name);
  const analysis = analyzeComplexity(fp);
  const obsResult = extractComplexityObservations(analysis);
  const result = interpretBranchClassification(fp, obsResult.observations);
  return [...result.assessments];
}

/**
 * Filter assessments to those from a specific function.
 */
function assessmentsForFunction(
  assessments: BranchClassificationAssessment[],
  functionName: string,
): BranchClassificationAssessment[] {
  return assessments.filter(a => a.evidence.functionName === functionName);
}

describe('ast-interpret-branch-classification', () => {
  const allAssessments = analyzeFixture('branch-classification-samples.tsx');

  describe('TYPE_DISPATCH', () => {
    it('classifies filtersType === literal as TYPE_DISPATCH with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'typeDispatchExample');
      const typeDispatches = assessments.filter(a => a.kind === 'TYPE_DISPATCH');

      expect(typeDispatches.length).toBeGreaterThanOrEqual(1);
      expect(typeDispatches[0].confidence).toBe('high');
      expect(typeDispatches[0].evidence.conditionText).toContain('filtersType');
    });

    it('extracts the dispatch target value', () => {
      const assessments = assessmentsForFunction(allAssessments, 'typeDispatchExample');
      const typeDispatches = assessments.filter(a => a.kind === 'TYPE_DISPATCH');

      expect(typeDispatches[0].evidence.dispatchTarget).toBe('teamProductivity');
    });
  });

  describe('NULL_GUARD', () => {
    it('classifies != null as NULL_GUARD with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'nullGuardExample');
      const nullGuards = assessments.filter(a => a.kind === 'NULL_GUARD');

      expect(nullGuards.length).toBeGreaterThanOrEqual(1);
      const ifGuard = nullGuards.find(a => a.evidence.contributorType === 'if');
      expect(ifGuard).toBeDefined();
      expect(ifGuard!.confidence).toBe('high');
    });

    it('classifies ?? as NULL_GUARD with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'nullGuardExample');
      const nullishGuards = assessments.filter(
        a => a.kind === 'NULL_GUARD' && a.evidence.contributorType === 'nullish-coalesce',
      );

      expect(nullishGuards.length).toBeGreaterThanOrEqual(1);
      expect(nullishGuards[0].confidence).toBe('high');
    });

    it('classifies !== undefined as NULL_GUARD', () => {
      const assessments = assessmentsForFunction(allAssessments, 'nullGuardUndefinedExample');
      const nullGuards = assessments.filter(a => a.kind === 'NULL_GUARD');

      expect(nullGuards.length).toBeGreaterThanOrEqual(1);
      expect(nullGuards[0].confidence).toBe('high');
    });
  });

  describe('ERROR_CHECK', () => {
    it('classifies isError as ERROR_CHECK with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'errorCheckExample');
      const errorChecks = assessments.filter(a => a.kind === 'ERROR_CHECK');

      expect(errorChecks.length).toBeGreaterThanOrEqual(1);
      const isErrorCheck = errorChecks.find(a => a.evidence.conditionText.includes('isError'));
      expect(isErrorCheck).toBeDefined();
      expect(isErrorCheck!.confidence).toBe('high');
    });

    it('classifies !data as ERROR_CHECK with medium confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'errorCheckExample');
      const errorChecks = assessments.filter(a => a.kind === 'ERROR_CHECK');

      const dataCheck = errorChecks.find(a => a.evidence.conditionText.includes('!data'));
      expect(dataCheck).toBeDefined();
      expect(dataCheck!.confidence).toBe('medium');
    });
  });

  describe('FEATURE_FLAG', () => {
    it('classifies featureFlags.showWorkstreams as FEATURE_FLAG with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'featureFlagExample');
      const flags = assessments.filter(a => a.kind === 'FEATURE_FLAG');

      expect(flags.length).toBeGreaterThanOrEqual(1);
      expect(flags[0].confidence).toBe('high');
      expect(flags[0].evidence.flagName).toContain('showWorkstreams');
    });
  });

  describe('LOADING_CHECK', () => {
    it('classifies isLoading as LOADING_CHECK with high confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'loadingCheckExample');
      const loadingChecks = assessments.filter(a => a.kind === 'LOADING_CHECK');

      expect(loadingChecks.length).toBeGreaterThanOrEqual(1);
      const isLoadingCheck = loadingChecks.find(a => a.evidence.conditionText.includes('isLoading'));
      expect(isLoadingCheck).toBeDefined();
      expect(isLoadingCheck!.confidence).toBe('high');
    });

    it('classifies isPending as LOADING_CHECK', () => {
      const assessments = assessmentsForFunction(allAssessments, 'loadingCheckExample');
      const isPendingCheck = assessments.find(
        a => a.kind === 'LOADING_CHECK' && a.evidence.conditionText.includes('isPending'),
      );

      expect(isPendingCheck).toBeDefined();
      expect(isPendingCheck!.confidence).toBe('high');
    });
  });

  describe('BOOLEAN_GUARD', () => {
    it('classifies isAdmin as BOOLEAN_GUARD with medium confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'booleanGuardExample');
      const guards = assessments.filter(a => a.kind === 'BOOLEAN_GUARD');

      expect(guards.length).toBeGreaterThanOrEqual(1);
      const isAdminGuard = guards.find(a => a.evidence.conditionText.includes('isAdmin'));
      expect(isAdminGuard).toBeDefined();
      expect(isAdminGuard!.confidence).toBe('medium');
    });

    it('classifies hasPermission as BOOLEAN_GUARD', () => {
      const assessments = assessmentsForFunction(allAssessments, 'booleanGuardExample');
      const guards = assessments.filter(a => a.kind === 'BOOLEAN_GUARD');

      const permGuard = guards.find(a => a.evidence.conditionText.includes('hasPermission'));
      expect(permGuard).toBeDefined();
    });
  });

  describe('OTHER', () => {
    it('classifies complex computed conditions as OTHER with low confidence', () => {
      const assessments = assessmentsForFunction(allAssessments, 'otherExample');
      const others = assessments.filter(a => a.kind === 'OTHER');

      expect(others.length).toBeGreaterThanOrEqual(1);
      expect(others[0].confidence).toBe('low');
    });
  });

  describe('ternary contributors', () => {
    it('classifies ternary with type discriminant as TYPE_DISPATCH', () => {
      const assessments = assessmentsForFunction(allAssessments, 'ternaryExamples');
      const typeDispatches = assessments.filter(a => a.kind === 'TYPE_DISPATCH');

      expect(typeDispatches.length).toBeGreaterThanOrEqual(1);
    });

    it('classifies ternary with null check as NULL_GUARD', () => {
      const assessments = assessmentsForFunction(allAssessments, 'ternaryExamples');
      const nullGuards = assessments.filter(a => a.kind === 'NULL_GUARD');

      expect(nullGuards.length).toBeGreaterThanOrEqual(1);
    });

    it('classifies ternary with feature flag as FEATURE_FLAG', () => {
      const assessments = assessmentsForFunction(allAssessments, 'ternaryExamples');
      const flags = assessments.filter(a => a.kind === 'FEATURE_FLAG');

      expect(flags.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('logical-and / logical-or contributors', () => {
    it('classifies logical-and with boolean guard', () => {
      const assessments = assessmentsForFunction(allAssessments, 'logicalExamples');
      const logicalAnds = assessments.filter(a => a.evidence.contributorType === 'logical-and');

      expect(logicalAnds.length).toBeGreaterThanOrEqual(1);
      // isAdmin && ... -> BOOLEAN_GUARD (isAdmin starts with 'is' prefix)
      expect(logicalAnds[0].kind).toBe('BOOLEAN_GUARD');
    });
  });

  describe('assessment structure', () => {
    it('includes basedOn reference to FUNCTION_COMPLEXITY observation', () => {
      expect(allAssessments.length).toBeGreaterThan(0);
      for (const a of allAssessments) {
        expect(a.basedOn.length).toBeGreaterThanOrEqual(1);
        expect(a.basedOn[0].kind).toBe('FUNCTION_COMPLEXITY');
      }
    });

    it('has evidence with functionName and contributorType', () => {
      for (const a of allAssessments) {
        expect(a.evidence.functionName).toBeTruthy();
        expect(a.evidence.contributorType).toBeTruthy();
        expect(typeof a.evidence.contributorLine).toBe('number');
      }
    });

    it('has valid confidence levels', () => {
      for (const a of allAssessments) {
        expect(['high', 'medium', 'low']).toContain(a.confidence);
      }
    });
  });

  describe('edge cases', () => {
    it('produces zero assessments for empty observations', () => {
      const result = interpretBranchClassification('test.ts', []);
      expect(result.assessments).toHaveLength(0);
    });

    it('handles observation with no contributors gracefully', () => {
      const obs: ComplexityObservation = {
        kind: 'FUNCTION_COMPLEXITY',
        file: 'test.ts',
        line: 1,
        evidence: {
          functionName: 'empty',
          endLine: 5,
          lineCount: 5,
          cyclomaticComplexity: 1,
          maxNestingDepth: 0,
          contributors: [],
        },
      };

      const result = interpretBranchClassification('test.ts', [obs]);
      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('heuristic priority order', () => {
    it('classifies nullish-coalesce as NULL_GUARD with high confidence', () => {
      const obs: ComplexityObservation = {
        kind: 'FUNCTION_COMPLEXITY',
        file: fixturePath('branch-classification-samples.tsx'),
        line: 1,
        evidence: {
          functionName: 'test',
          endLine: 5,
          lineCount: 5,
          cyclomaticComplexity: 2,
          maxNestingDepth: 1,
          contributors: [{ type: 'nullish-coalesce', line: 3 }],
        },
      };

      const result = interpretBranchClassification(fixturePath('branch-classification-samples.tsx'), [obs]);
      const nullGuards = result.assessments.filter(a => a.kind === 'NULL_GUARD');
      expect(nullGuards.length).toBe(1);
      expect(nullGuards[0].confidence).toBe('high');
    });
  });
});
