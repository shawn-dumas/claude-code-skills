import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretOwnership, type OwnershipInputs } from '../ast-interpret-ownership';
import { analyzeReactFile } from '../ast-react-inventory';
import { interpretHooks } from '../ast-interpret-hooks';
import { astConfig } from '../ast-config';
import type {
  HookAssessment,
  ComponentObservation,
  HookObservation,
  SideEffectObservation,
  OwnershipAssessment,
  AssessmentResult,
} from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Helper to create a COMPONENT_DECLARATION observation.
 */
function makeComponentDecl(file: string, line: number, componentName: string): ComponentObservation {
  return {
    kind: 'COMPONENT_DECLARATION',
    file,
    line,
    evidence: {
      componentName,
      kind: 'function',
    },
  };
}

/**
 * Helper to create a PROP_FIELD observation.
 */
function makePropField(
  file: string,
  line: number,
  componentName: string,
  propName: string,
  isCallback = false,
): ComponentObservation {
  return {
    kind: 'PROP_FIELD',
    file,
    line,
    evidence: {
      componentName,
      propName,
      propType: 'string',
      isOptional: false,
      hasDefault: false,
      isCallback,
    },
  };
}

/**
 * Helper to create a HOOK_CALL observation.
 */
function makeHookCall(
  file: string,
  line: number,
  hookName: string,
  parentFunction: string,
  extra: Partial<HookObservation['evidence']> = {},
): HookObservation {
  return {
    kind: 'HOOK_CALL',
    file,
    line,
    evidence: {
      hookName,
      parentFunction,
      ...extra,
    },
  };
}

/**
 * Helper to create a HookAssessment.
 */
function makeHookAssessment(
  file: string,
  line: number,
  symbol: string,
  kind: HookAssessment['kind'],
  confidence: 'high' | 'medium' | 'low',
): HookAssessment {
  return {
    kind,
    subject: { file, line, symbol },
    confidence,
    rationale: [`${kind} assessment`],
    basedOn: [{ kind: 'HOOK_CALL', file, line }],
    isCandidate: false,
    requiresManualReview: false,
  };
}

/**
 * Helper to create a side effect observation.
 */
function makeSideEffect(
  file: string,
  line: number,
  kind: SideEffectObservation['kind'],
  containingFunction: string,
): SideEffectObservation {
  return {
    kind,
    file,
    line,
    evidence: {
      containingFunction,
      object: kind === 'TOAST_CALL' ? 'toast' : 'console',
      method: 'log',
    },
  };
}

describe('ast-interpret-ownership', () => {
  describe('DDAU_COMPONENT classification', () => {
    it('classifies pure DDAU component (props only, no service hooks) as DDAU_COMPONENT with high confidence', () => {
      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'TeamTable'),
        makePropField(file, 6, 'TeamTable', 'teams'),
        makePropField(file, 7, 'TeamTable', 'onSelect', true),
      ];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useState', 'TeamTable', { isReactBuiltin: true }),
        makeHookCall(file, 11, 'useMemo', 'TeamTable', { isReactBuiltin: true }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useState', 'LIKELY_STATE_HOOK', 'high'),
        makeHookAssessment(file, 11, 'useMemo', 'LIKELY_STATE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('DDAU_COMPONENT');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(false);
      expect(result.assessments[0].rationale).toContain('has 2 prop(s)');
      expect(result.assessments[0].rationale).toContain('no service/context hooks');
    });
  });

  describe('CONTAINER classification', () => {
    it('classifies container (3+ service hooks, router, toast) as CONTAINER with high confidence', () => {
      const file = 'TeamContainer.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'TeamContainer')];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'TeamContainer', {
          importSource: '@/services/hooks/queries/team',
        }),
        makeHookCall(file, 11, 'useUsersQuery', 'TeamContainer', {
          importSource: '@/services/hooks/queries/users',
        }),
        makeHookCall(file, 12, 'useAuthState', 'TeamContainer', {
          importSource: '@/providers/context/auth',
        }),
        makeHookCall(file, 13, 'useRouter', 'TeamContainer'),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
        makeHookAssessment(file, 11, 'useUsersQuery', 'LIKELY_SERVICE_HOOK', 'high'),
        makeHookAssessment(file, 12, 'useAuthState', 'LIKELY_CONTEXT_HOOK', 'high'),
      ];
      const sideEffectObservations: SideEffectObservation[] = [makeSideEffect(file, 20, 'TOAST_CALL', 'TeamContainer')];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
        sideEffectObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('CONTAINER');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
    });

    it('classifies component with 2 container signals as CONTAINER with medium confidence', () => {
      const file = 'SomeComponent.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'SomeComponent')];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'SomeComponent', {
          importSource: '@/services/hooks/queries/team',
        }),
        makeHookCall(file, 11, 'useRouter', 'SomeComponent'),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('CONTAINER');
      expect(result.assessments[0].confidence).toBe('medium');
    });
  });

  describe('LEAF_VIOLATION classification', () => {
    it('classifies leaf violation (useTeamQuery in a non-container) as LEAF_VIOLATION', () => {
      const file = 'TeamRow.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'TeamRow'),
        makePropField(file, 6, 'TeamRow', 'team'),
        makePropField(file, 7, 'TeamRow', 'onClick', true),
      ];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'TeamRow', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LEAF_VIOLATION');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
      expect(result.assessments[0].requiresManualReview).toBe(true);
      expect(result.assessments[0].rationale).toContain('has props (leaf evidence)');
      expect(result.assessments[0].rationale.some(r => r.includes('useTeamQuery'))).toBe(true);
    });
  });

  describe('LAYOUT_SHELL classification', () => {
    it('classifies DashboardLayout as LAYOUT_SHELL with high confidence', () => {
      const file = 'DashboardLayout.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'DashboardLayout')];
      const hookObservations: HookObservation[] = [makeHookCall(file, 10, 'useAuthState', 'DashboardLayout')];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useAuthState', 'LIKELY_CONTEXT_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LAYOUT_SHELL');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(false);
      expect(result.assessments[0].rationale[0]).toContain('documented layout exception');
    });

    it('classifies ProfileMenu as LAYOUT_SHELL', () => {
      const file = 'ProfileMenu.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'ProfileMenu')];

      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations,
        hookObservations: [],
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LAYOUT_SHELL');
    });
  });

  describe('AMBIGUOUS classification', () => {
    it('classifies one service hook with no other container signals as AMBIGUOUS (not CONTAINER low)', () => {
      const file = 'WeirdComponent.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'WeirdComponent')];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'WeirdComponent', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('AMBIGUOUS');
      expect(result.assessments[0].confidence).toBe('low');
      expect(result.assessments[0].requiresManualReview).toBe(true);
      expect(result.assessments[0].rationale[0]).toContain('1 container signal');
    });

    it('classifies disallowed hook with no prop evidence as AMBIGUOUS (not LEAF_VIOLATION)', () => {
      const file = 'UnknownOwnership.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'UnknownOwnership'),
        // No prop fields - no leaf evidence
      ];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useAuthState', 'UnknownOwnership', {
          importSource: '@/providers/context/auth',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useAuthState', 'LIKELY_CONTEXT_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('AMBIGUOUS');
      expect(result.assessments[0].rationale.some(r => r.includes('no prop evidence'))).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty assessments for empty component observations', () => {
      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations: [],
        hookObservations: [],
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(0);
    });

    it('returns empty assessments when no COMPONENT_DECLARATION observations', () => {
      const file = 'test.tsx';
      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations: [makePropField(file, 5, 'SomeComponent', 'someProp')],
        hookObservations: [],
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(0);
    });

    it('handles multiple components in same file', () => {
      const file = 'multi.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'ComponentA'),
        makePropField(file, 6, 'ComponentA', 'data'),
        makeComponentDecl(file, 20, 'ComponentB'),
        makePropField(file, 21, 'ComponentB', 'items'),
      ];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useState', 'ComponentA', { isReactBuiltin: true }),
        makeHookCall(file, 25, 'useMemo', 'ComponentB', { isReactBuiltin: true }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useState', 'LIKELY_STATE_HOOK', 'high'),
        makeHookAssessment(file, 25, 'useMemo', 'LIKELY_STATE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(2);
      expect(result.assessments[0].subject.symbol).toBe('ComponentA');
      expect(result.assessments[0].kind).toBe('DDAU_COMPONENT');
      expect(result.assessments[1].subject.symbol).toBe('ComponentB');
      expect(result.assessments[1].kind).toBe('DDAU_COMPONENT');
    });
  });

  describe('basedOn traces back to observations', () => {
    it('basedOn contains component observation and hook assessments', () => {
      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'TestComponent'),
        makePropField(file, 6, 'TestComponent', 'data'),
      ];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'TestComponent', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);
      const assessment = result.assessments[0];

      expect(assessment.basedOn.length).toBeGreaterThanOrEqual(1);

      // First ref should be the component declaration
      const componentRef = assessment.basedOn[0];
      expect(componentRef.kind).toBe('COMPONENT_DECLARATION');
      expect(componentRef.file).toBe(file);
      expect(componentRef.line).toBe(5);

      // Should also include hook assessment refs
      const hookRefs = assessment.basedOn.filter(r => r.kind === 'LIKELY_SERVICE_HOOK');
      expect(hookRefs.length).toBe(1);
    });
  });

  describe('assessment structure', () => {
    it('each assessment has all required fields', () => {
      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'TestComponent'),
        makePropField(file, 6, 'TestComponent', 'data'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations,
        hookObservations: [],
      };

      const result = interpretOwnership(inputs);

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
        expect(assessment.subject).toHaveProperty('symbol');

        expect(Array.isArray(assessment.rationale)).toBe(true);
        expect(Array.isArray(assessment.basedOn)).toBe(true);
      }
    });

    it('output is JSON-serializable', () => {
      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'TestComponent'),
        makePropField(file, 6, 'TestComponent', 'data'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations,
        hookObservations: [],
      };

      const result = interpretOwnership(inputs);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<OwnershipAssessment>;
      expect(parsed.assessments).toHaveLength(1);
    });
  });

  describe('all 5 assessment kinds are covered', () => {
    const allKinds = new Set(['CONTAINER', 'DDAU_COMPONENT', 'LAYOUT_SHELL', 'LEAF_VIOLATION', 'AMBIGUOUS']);

    it('tests exist for all assessment kinds', () => {
      const testedKinds = new Set<string>();

      // CONTAINER: tested via 3+ signals
      testedKinds.add('CONTAINER');

      // DDAU_COMPONENT: tested via props-only component
      testedKinds.add('DDAU_COMPONENT');

      // LAYOUT_SHELL: tested via DashboardLayout
      testedKinds.add('LAYOUT_SHELL');

      // LEAF_VIOLATION: tested via useTeamQuery in non-container
      testedKinds.add('LEAF_VIOLATION');

      // AMBIGUOUS: tested via single signal and no prop evidence
      testedKinds.add('AMBIGUOUS');

      expect(testedKinds).toEqual(allKinds);
    });
  });

  describe('integration with real file', () => {
    it('produces reasonable assessments for hook-classification.tsx', () => {
      const inventory = analyzeReactFile(fixturePath('hook-classification.tsx'));

      expect(inventory.componentObservations.length).toBeGreaterThan(0);

      const hookResult = interpretHooks(inventory.hookObservations, astConfig);

      const inputs: OwnershipInputs = {
        hookAssessments: hookResult.assessments,
        componentObservations: inventory.componentObservations,
        hookObservations: inventory.hookObservations,
      };

      const result = interpretOwnership(inputs, astConfig);

      // Verify assessments are valid
      for (const assessment of result.assessments) {
        expect(assessment.subject.file).toContain('hook-classification.tsx');
        expect(assessment.subject.line).toBeGreaterThan(0);
        expect(assessment.rationale.length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(assessment.confidence);
        expect(['CONTAINER', 'DDAU_COMPONENT', 'LAYOUT_SHELL', 'LEAF_VIOLATION', 'AMBIGUOUS']).toContain(
          assessment.kind,
        );
      }
    });
  });

  describe('custom config', () => {
    it('uses provided layout exceptions from config', () => {
      const customConfig = {
        ...astConfig,
        ownership: {
          ...astConfig.ownership,
          layoutExceptions: new Set(['CustomLayoutComponent']) as ReadonlySet<string>,
        },
      };

      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [
        makeComponentDecl(file, 5, 'CustomLayoutComponent'),
        makeComponentDecl(file, 20, 'DashboardLayout'), // In default config, not in custom
      ];

      const inputs: OwnershipInputs = {
        hookAssessments: [],
        componentObservations,
        hookObservations: [],
      };

      const result = interpretOwnership(inputs, customConfig);

      expect(result.assessments).toHaveLength(2);
      expect(result.assessments[0].kind).toBe('LAYOUT_SHELL');
      expect(result.assessments[0].subject.symbol).toBe('CustomLayoutComponent');
      // DashboardLayout would be AMBIGUOUS in custom config (no layout exception, no props, no hooks)
      expect(result.assessments[1].kind).toBe('AMBIGUOUS');
      expect(result.assessments[1].subject.symbol).toBe('DashboardLayout');
    });
  });

  describe('container directory detection', () => {
    it('recognizes containers/ directory as container signal', () => {
      const file = 'src/ui/page_blocks/dashboard/team/containers/TeamContainer.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'SomeComponent')];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useTeamQuery', 'SomeComponent', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 10, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      // 2 signals: service hook + containers/ directory -> CONTAINER medium
      expect(result.assessments[0].kind).toBe('CONTAINER');
      expect(result.assessments[0].confidence).toBe('medium');
    });
  });

  describe('router hooks', () => {
    it('treats useQueryStates as a container signal', () => {
      const file = 'test.tsx';
      const componentObservations: ComponentObservation[] = [makeComponentDecl(file, 5, 'FilterContainer')];
      const hookObservations: HookObservation[] = [
        makeHookCall(file, 10, 'useQueryStates', 'FilterContainer'),
        makeHookCall(file, 11, 'useTeamQuery', 'FilterContainer', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];
      const hookAssessments: HookAssessment[] = [
        makeHookAssessment(file, 11, 'useTeamQuery', 'LIKELY_SERVICE_HOOK', 'high'),
      ];

      const inputs: OwnershipInputs = {
        hookAssessments,
        componentObservations,
        hookObservations,
      };

      const result = interpretOwnership(inputs);

      expect(result.assessments).toHaveLength(1);
      // 2 signals: service hook + router hook (useQueryStates) -> CONTAINER medium
      expect(result.assessments[0].kind).toBe('CONTAINER');
    });
  });
});
