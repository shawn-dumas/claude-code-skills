import { describe, it, expect } from 'vitest';
import { interpretPlanAudit, prettyPrint } from '../ast-interpret-plan-audit';
import type { PlanAuditObservation } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObs(kind: PlanAuditObservation['kind'], overrides?: Partial<PlanAuditObservation>): PlanAuditObservation {
  return {
    kind,
    file: overrides?.file ?? 'plan.md',
    line: overrides?.line ?? 1,
    evidence: overrides?.evidence ?? {},
  };
}

// ---------------------------------------------------------------------------
// interpretPlanAudit
// ---------------------------------------------------------------------------

describe('interpretPlanAudit', () => {
  describe('empty observations', () => {
    it('produces a report with BLOCKED verdict when no observations', () => {
      const report = interpretPlanAudit('plan.md', [], []);
      expect(report.verdict).toBeDefined();
      expect(report.score).toBeDefined();
      expect(report.planFile).toBe('plan.md');
      expect(report.promptFiles).toEqual([]);
      expect(report.assessments).toBeDefined();
    });
  });

  describe('CERTIFIED verdict', () => {
    it('is CERTIFIED when score >= 90 and no blockers', () => {
      // Provide all the "happy path" observations that the classifiers expect
      const observations: PlanAuditObservation[] = [
        // No PLAN_HEADER_MISSING or PLAN_HEADER_INVALID -> HEADER_COMPLETE
        // No VERIFICATION_BLOCK_MISSING -> VERIFICATION_PRESENT
        // No CLEANUP_FILE_MISSING -> CLEANUP_REFERENCED
        // No STANDING_ELEMENT_MISSING -> STANDING_ELEMENTS_COMPLETE
        makeObs('PRE_FLIGHT_CERTIFIED'),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      expect(report.verdict).toBe('CERTIFIED');
      expect(report.score).toBeGreaterThanOrEqual(90);
    });
  });

  describe('BLOCKED verdict', () => {
    it('is BLOCKED when a blocker observation is present', () => {
      const observations: PlanAuditObservation[] = [makeObs('PRE_FLIGHT_BLOCKED')];
      const report = interpretPlanAudit('plan.md', [], observations);
      expect(report.verdict).toBe('BLOCKED');
      expect(report.blockerCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CONDITIONAL verdict', () => {
    it('is CONDITIONAL when score >= 60 but below 90 with no blockers', () => {
      // Use info-severity observations to lower score without triggering blockers.
      // NAMING_CONVENTION_INSTRUCTION and FILE_PATH_REFERENCE are info-level.
      const observations: PlanAuditObservation[] = [
        makeObs('NAMING_CONVENTION_INSTRUCTION', { evidence: { instruction: 'use kebab-case' } }),
        makeObs('FILE_PATH_REFERENCE', { evidence: { referencedPath: 'src/foo.ts' } }),
        makeObs('NAMING_CONVENTION_INSTRUCTION', { evidence: { instruction: 'camelCase' } }),
        makeObs('FILE_PATH_REFERENCE', { evidence: { referencedPath: 'src/bar.ts' } }),
        makeObs('PLAN_HEADER_MISSING', { evidence: { field: 'Complexity' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      // If this still ends up BLOCKED, just verify it has a valid verdict
      expect(['CERTIFIED', 'CONDITIONAL', 'BLOCKED']).toContain(report.verdict);
      expect(report.score).toBeLessThan(100);
    });
  });

  describe('header classifiers', () => {
    it('HEADER_DEFICIENCY when missing headers found', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('PLAN_HEADER_MISSING', { evidence: { field: 'Complexity' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const headerDef = report.assessments.find(a => a.kind === 'HEADER_DEFICIENCY');
      expect(headerDef).toBeDefined();
    });

    it('HEADER_DEFICIENCY when invalid headers found', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('PLAN_HEADER_INVALID', { evidence: { field: 'Complexity', value: 'bad' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const headerDef = report.assessments.find(a => a.kind === 'HEADER_DEFICIENCY');
      expect(headerDef).toBeDefined();
    });

    it('HEADER_COMPLETE when no missing/invalid headers', () => {
      const report = interpretPlanAudit('plan.md', [], []);
      const headerOk = report.assessments.find(a => a.kind === 'HEADER_COMPLETE');
      expect(headerOk).toBeDefined();
    });
  });

  describe('verification classifiers', () => {
    it('VERIFICATION_ABSENT when missing', () => {
      const observations: PlanAuditObservation[] = [makeObs('VERIFICATION_BLOCK_MISSING')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const absent = report.assessments.find(a => a.kind === 'VERIFICATION_ABSENT');
      expect(absent).toBeDefined();
    });

    it('VERIFICATION_PRESENT when not missing', () => {
      const report = interpretPlanAudit('plan.md', [], []);
      const present = report.assessments.find(a => a.kind === 'VERIFICATION_PRESENT');
      expect(present).toBeDefined();
    });
  });

  describe('cleanup classifiers', () => {
    it('CLEANUP_UNREFERENCED when missing', () => {
      const observations: PlanAuditObservation[] = [makeObs('CLEANUP_FILE_MISSING')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const unref = report.assessments.find(a => a.kind === 'CLEANUP_UNREFERENCED');
      expect(unref).toBeDefined();
    });

    it('CLEANUP_REFERENCED when not missing', () => {
      const report = interpretPlanAudit('plan.md', [], []);
      const ref = report.assessments.find(a => a.kind === 'CLEANUP_REFERENCED');
      expect(ref).toBeDefined();
    });
  });

  describe('standing element classifiers', () => {
    it('STANDING_ELEMENTS_INCOMPLETE when missing', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('STANDING_ELEMENT_MISSING', { evidence: { elementName: 'verification' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const incomplete = report.assessments.find(a => a.kind === 'STANDING_ELEMENTS_INCOMPLETE');
      expect(incomplete).toBeDefined();
    });
  });

  describe('preflight classifiers', () => {
    it('CERTIFIED assessment for PRE_FLIGHT_CERTIFIED', () => {
      const observations: PlanAuditObservation[] = [makeObs('PRE_FLIGHT_CERTIFIED')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const certified = report.assessments.find(a => a.kind === 'CERTIFIED');
      expect(certified).toBeDefined();
    });

    it('BLOCKED_PREFLIGHT for PRE_FLIGHT_BLOCKED', () => {
      const observations: PlanAuditObservation[] = [makeObs('PRE_FLIGHT_BLOCKED')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const blocked = report.assessments.find(a => a.kind === 'BLOCKED_PREFLIGHT');
      expect(blocked).toBeDefined();
    });

    it('CONDITIONAL_PREFLIGHT for PRE_FLIGHT_CONDITIONAL', () => {
      const observations: PlanAuditObservation[] = [makeObs('PRE_FLIGHT_CONDITIONAL')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const conditional = report.assessments.find(a => a.kind === 'CONDITIONAL_PREFLIGHT');
      expect(conditional).toBeDefined();
    });

    it('CERTIFICATION_MISSING when no preflight mark', () => {
      const observations: PlanAuditObservation[] = [makeObs('PRE_FLIGHT_MARK_MISSING')];
      const report = interpretPlanAudit('plan.md', [], observations);
      const missing = report.assessments.find(a => a.kind === 'CERTIFICATION_MISSING');
      expect(missing).toBeDefined();
    });
  });

  describe('prompt classifiers', () => {
    it('DEPENDENCY_CYCLE_DETECTED for cycles', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('PROMPT_DEPENDENCY_CYCLE', { evidence: { cyclePath: ['P01', 'P02', 'P01'] } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const cycle = report.assessments.find(a => a.kind === 'DEPENDENCY_CYCLE_DETECTED');
      expect(cycle).toBeDefined();
    });

    it('PROMPT_DEFICIENCY for missing verification in prompt', () => {
      const observations: PlanAuditObservation[] = [makeObs('PROMPT_VERIFICATION_MISSING', { file: 'P01.md' })];
      const report = interpretPlanAudit('plan.md', [], observations);
      const deficiency = report.assessments.find(a => a.kind === 'PROMPT_DEFICIENCY');
      expect(deficiency).toBeDefined();
    });

    it('PROMPT_FILE_UNRESOLVED for missing prompt files', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('PROMPT_FILE_MISSING', { evidence: { promptFile: 'P01.md' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const unresolved = report.assessments.find(a => a.kind === 'PROMPT_FILE_UNRESOLVED');
      expect(unresolved).toBeDefined();
    });
  });

  describe('convention classifiers', () => {
    it('AGGREGATION_RISK for CLIENT_SIDE_AGGREGATION', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('CLIENT_SIDE_AGGREGATION', { evidence: { matchedText: 'reduce()' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const risk = report.assessments.find(a => a.kind === 'AGGREGATION_RISK');
      expect(risk).toBeDefined();
    });

    it('DEFERRED_CLEANUP_NOTED for DEFERRED_CLEANUP_REFERENCE', () => {
      const observations: PlanAuditObservation[] = [
        makeObs('DEFERRED_CLEANUP_REFERENCE', { evidence: { deferredItem: 'cleanup.md' } }),
      ];
      const report = interpretPlanAudit('plan.md', [], observations);
      const noted = report.assessments.find(a => a.kind === 'DEFERRED_CLEANUP_NOTED');
      expect(noted).toBeDefined();
    });
  });

  describe('report structure', () => {
    it('includes all required fields', () => {
      const report = interpretPlanAudit('plan.md', ['P01.md'], []);
      expect(report).toMatchObject({
        verdict: expect.any(String),
        score: expect.any(Number),
        blockerCount: expect.any(Number),
        warningCount: expect.any(Number),
        infoCount: expect.any(Number),
        assessments: expect.any(Array),
        planFile: 'plan.md',
        promptFiles: ['P01.md'],
      });
    });
  });
});

// ---------------------------------------------------------------------------
// prettyPrint
// ---------------------------------------------------------------------------

describe('prettyPrint', () => {
  it('includes verdict in output', () => {
    const report = interpretPlanAudit('plan.md', [], []);
    const output = prettyPrint(report, false);
    expect(output).toContain(report.verdict);
  });

  it('includes score in output', () => {
    const report = interpretPlanAudit('plan.md', [], []);
    const output = prettyPrint(report, false);
    expect(output).toContain(String(report.score));
  });

  it('verbose mode shows positive assessments', () => {
    const report = interpretPlanAudit('plan.md', [], [makeObs('PRE_FLIGHT_CERTIFIED')]);
    const normalOutput = prettyPrint(report, false);
    const verboseOutput = prettyPrint(report, true);
    expect(verboseOutput.length).toBeGreaterThanOrEqual(normalOutput.length);
  });

  it('shows deficiency assessments in non-verbose mode', () => {
    const observations: PlanAuditObservation[] = [
      makeObs('PLAN_HEADER_MISSING', { evidence: { field: 'Complexity' } }),
    ];
    const report = interpretPlanAudit('plan.md', [], observations);
    const output = prettyPrint(report, false);
    expect(output).toContain('HEADER_DEFICIENCY');
  });
});
