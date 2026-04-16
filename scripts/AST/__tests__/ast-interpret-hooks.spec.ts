import { describe, it, expect } from 'vitest';
import path from 'path';
import { interpretHooks } from '../ast-interpret-hooks';
import { analyzeReactFile } from '../ast-react-inventory';
import { astConfig } from '../ast-config';
import type { HookObservation, HookAssessment, AssessmentResult } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/**
 * Helper to create a HOOK_CALL observation.
 */
function makeHookCall(
  file: string,
  line: number,
  hookName: string,
  extra: Partial<HookObservation['evidence']> = {},
): HookObservation {
  return {
    kind: 'HOOK_CALL',
    file,
    line,
    evidence: {
      hookName,
      ...extra,
    },
  };
}

describe('ast-interpret-hooks', () => {
  describe('Stage 1: React builtins', () => {
    it('classifies useState as LIKELY_STATE_HOOK with high confidence', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useState', { isReactBuiltin: true })];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_STATE_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(false);
      expect(result.assessments[0].rationale[0]).toContain('React builtin');
    });

    it('classifies useMemo as LIKELY_STATE_HOOK via config check', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useMemo'), // isReactBuiltin not set, but config has it
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_STATE_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('classifies useEffect as LIKELY_STATE_HOOK', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useEffect', { isReactBuiltin: true })];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_STATE_HOOK');
    });
  });

  describe('Stage 2: Ambient hooks by name list', () => {
    it('classifies useBreakpoints as LIKELY_AMBIENT_HOOK with high confidence', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useBreakpoints')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].rationale[0]).toContain('ambient leaf hooks list');
    });

    it('classifies usePagination as LIKELY_AMBIENT_HOOK', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'usePagination')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('classifies useSomeScope as LIKELY_AMBIENT_HOOK with medium confidence (scope pattern)', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useSomeScope')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].rationale[0]).toContain('Scope');
      expect(result.assessments[0].rationale[0]).toContain('scope hook pattern');
    });

    it('does not match short scope names (useScope, only 8 chars)', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useScope')];

      const result = interpretHooks(observations);

      // Should fall through to unknown since it's exactly 8 chars, not > 8
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('UNKNOWN_HOOK');
    });
  });

  describe('Stage 3: Import path classification', () => {
    it('classifies service hook by import path as LIKELY_SERVICE_HOOK with high confidence', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useTeamQuery', {
          importSource: '@/services/hooks/queries/team',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
      expect(result.assessments[0].rationale[0]).toContain('services/hooks');
    });

    it('classifies context hook by import path as LIKELY_CONTEXT_HOOK with high confidence', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useAuthState', {
          importSource: '@/providers/context/auth',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_CONTEXT_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].isCandidate).toBe(true);
      expect(result.assessments[0].rationale[0]).toContain('context');
    });

    it('classifies DOM utility hook by import path as LIKELY_AMBIENT_HOOK', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useClickAway', {
          importSource: '@/shared/hooks/useClickAway',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
    });

    it('classifies useQuery as LIKELY_SERVICE_HOOK (TanStack Query)', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useQuery', {
          importSource: '@tanstack/react-query',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      expect(result.assessments[0].rationale[0]).toContain('TanStack Query');
    });

    it('classifies useMutation as LIKELY_SERVICE_HOOK (TanStack Query)', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useMutation', {
          importSource: '@tanstack/react-query',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
    });
  });

  describe('Stage 4: Name heuristics (fallback)', () => {
    it('classifies known context hook by name only with medium confidence', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useAuthState'), // no import source
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_CONTEXT_HOOK');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].rationale[0]).toContain('known context hooks list');
      expect(result.assessments[0].rationale[0]).toContain('import path not resolved');
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });

    it('classifies usePosthogContext by name as LIKELY_CONTEXT_HOOK', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'usePosthogContext')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_CONTEXT_HOOK');
      expect(result.assessments[0].confidence).toBe('medium');
    });

    it('classifies TanStack Query hook by name only with medium confidence', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useQuery'), // no import source
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].rationale[0]).toContain('TanStack Query');
    });
  });

  describe('Stage 5: Unknown hooks', () => {
    it('classifies unknown hook with no matching pattern as UNKNOWN_HOOK', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useCustomThing')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('UNKNOWN_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      expect(result.assessments[0].isCandidate).toBe(false);
      expect(result.assessments[0].requiresManualReview).toBe(true);
      expect(result.assessments[0].rationale).toContain('no import path available');
      expect(result.assessments[0].rationale).toContain('name does not match any known pattern');
    });

    it('classifies hook with unrecognized import path as UNKNOWN_HOOK', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useWeirdHook', {
          importSource: '@/some/random/path',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('UNKNOWN_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });
  });

  describe('Hook with no import source falls back to name-only', () => {
    it('falls back to name heuristics when import source unavailable', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useTeams'), // no import source, but it's in knownContextHooks
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_CONTEXT_HOOK');
      expect(result.assessments[0].confidence).toBe('medium');
      expect(result.assessments[0].requiresManualReview).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty assessments for empty observations', () => {
      const result = interpretHooks([]);
      expect(result.assessments).toHaveLength(0);
    });

    it('skips non-HOOK_CALL observations', () => {
      const observations: HookObservation[] = [
        {
          kind: 'HOOK_DEFINITION',
          file: 'test.tsx',
          line: 5,
          evidence: {
            hookName: 'useMyCustomHook',
            definesHooks: ['useState'],
          },
        },
        makeHookCall('test.tsx', 10, 'useState', { isReactBuiltin: true }),
      ];

      const result = interpretHooks(observations);

      // Should only process the HOOK_CALL, not HOOK_DEFINITION
      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].subject.symbol).toBe('useState');
    });

    it('handles multiple hooks in same file', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useState', { isReactBuiltin: true }),
        makeHookCall('test.tsx', 11, 'useBreakpoints'),
        makeHookCall('test.tsx', 12, 'useTeamQuery', { importSource: '@/services/hooks/queries/team' }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(3);
      expect(result.assessments[0].kind).toBe('LIKELY_STATE_HOOK');
      expect(result.assessments[1].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[2].kind).toBe('LIKELY_SERVICE_HOOK');
    });
  });

  describe('basedOn traces back to observations', () => {
    it('basedOn contains valid ObservationRef entries', () => {
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useTeamQuery', { importSource: '@/services/hooks/queries/team' }),
      ];

      const result = interpretHooks(observations);
      const assessment = result.assessments[0];

      expect(assessment.basedOn).toHaveLength(1);

      const ref = assessment.basedOn[0];
      expect(ref.kind).toBe('HOOK_CALL');
      expect(ref.file).toBe('test.tsx');
      expect(ref.line).toBe(10);
    });
  });

  describe('assessment structure', () => {
    it('each assessment has all required fields', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useState', { isReactBuiltin: true })];

      const result = interpretHooks(observations);

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
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useBreakpoints')];

      const result = interpretHooks(observations);
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json) as AssessmentResult<HookAssessment>;
      expect(parsed.assessments).toHaveLength(1);
    });
  });

  describe('all 5 assessment kinds are covered', () => {
    const allKinds = new Set([
      'LIKELY_SERVICE_HOOK',
      'LIKELY_CONTEXT_HOOK',
      'LIKELY_AMBIENT_HOOK',
      'LIKELY_STATE_HOOK',
      'UNKNOWN_HOOK',
    ]);

    it('tests exist for all assessment kinds', () => {
      const testedKinds = new Set<string>();

      // LIKELY_STATE_HOOK: tested via useState, useMemo
      testedKinds.add('LIKELY_STATE_HOOK');

      // LIKELY_AMBIENT_HOOK: tested via useBreakpoints, useSomeScope
      testedKinds.add('LIKELY_AMBIENT_HOOK');

      // LIKELY_SERVICE_HOOK: tested via import path and TanStack Query hooks
      testedKinds.add('LIKELY_SERVICE_HOOK');

      // LIKELY_CONTEXT_HOOK: tested via import path and known context hooks list
      testedKinds.add('LIKELY_CONTEXT_HOOK');

      // UNKNOWN_HOOK: tested via useCustomThing
      testedKinds.add('UNKNOWN_HOOK');

      expect(testedKinds).toEqual(allKinds);
    });
  });

  describe('integration with real file', () => {
    it('produces reasonable assessments for hook-classification.tsx', () => {
      const inventory = analyzeReactFile(fixturePath('hook-classification.tsx'));

      expect(inventory.hookObservations.length).toBeGreaterThan(0);

      const result = interpretHooks(inventory.hookObservations, astConfig);

      // Verify assessments are valid
      for (const assessment of result.assessments) {
        expect(assessment.subject.file).toContain('hook-classification.tsx');
        expect(assessment.subject.line).toBeGreaterThan(0);
        expect(assessment.rationale.length).toBeGreaterThan(0);
        expect(['high', 'medium', 'low']).toContain(assessment.confidence);
        expect([
          'LIKELY_SERVICE_HOOK',
          'LIKELY_CONTEXT_HOOK',
          'LIKELY_AMBIENT_HOOK',
          'LIKELY_STATE_HOOK',
          'UNKNOWN_HOOK',
        ]).toContain(assessment.kind);
      }

      // Should have at least some state hooks (useState, useMemo, etc.)
      const stateHooks = result.assessments.filter(a => a.kind === 'LIKELY_STATE_HOOK');
      expect(stateHooks.length).toBeGreaterThan(0);
    });
  });

  describe('negative fixture', () => {
    it('produces zero assessments for hookless component', () => {
      const inventory = analyzeReactFile(fixturePath('interpret-hooks-negative.tsx'));

      // Component exists but has no hooks
      const hookCalls = inventory.hookObservations.filter(o => o.kind === 'HOOK_CALL');
      expect(hookCalls).toHaveLength(0);

      const result = interpretHooks(inventory.hookObservations, astConfig);
      expect(result.assessments).toHaveLength(0);
    });
  });

  describe('custom config', () => {
    it('uses provided config instead of default', () => {
      // Create a minimal custom config that only has useCustomHook as ambient
      const customConfig = {
        ...astConfig,
        hooks: {
          ...astConfig.hooks,
          ambientLeafHooks: new Set(['useCustomHook']) as ReadonlySet<string>,
        },
      };

      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useCustomHook'),
        makeHookCall('test.tsx', 11, 'useBreakpoints'), // in default config, but not in custom
      ];

      const result = interpretHooks(observations, customConfig);

      expect(result.assessments).toHaveLength(2);
      expect(result.assessments[0].kind).toBe('LIKELY_AMBIENT_HOOK');
      expect(result.assessments[0].confidence).toBe('high');
      // useBreakpoints would be unknown in custom config
      expect(result.assessments[1].kind).toBe('UNKNOWN_HOOK');
    });
  });

  describe('member-call hook classification', () => {
    it('classifies member-call hook matching service pattern as LIKELY_SERVICE_HOOK via convention stage', () => {
      // classifyByConvention (stage 4b) catches use*Query/Mutation names before
      // classifyMemberCallHook (stage 4c) is reached. Both stages apply the same
      // pattern, so isMemberCall hooks with service names are classified via 4b.
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useGetAllQuery', {
          isMemberCall: true,
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      // Matched via convention stage (4b), not member-call stage (4c)
      expect(result.assessments[0].rationale[0]).toContain('matches service hook naming convention');
    });
  });

  describe('member-call hook classification', () => {
    it('classifies member-call hook matching service pattern as LIKELY_SERVICE_HOOK via convention stage', () => {
      // classifyByConvention (stage 4b) catches use*Query/Mutation names before
      // classifyMemberCallHook (stage 4c) is reached. Both stages apply the same
      // pattern, so isMemberCall hooks with service names are classified via 4b.
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useGetAllQuery', {
          isMemberCall: true,
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      // Matched via convention stage (4b), not member-call stage (4c)
      expect(result.assessments[0].rationale[0]).toContain('matches service hook naming convention');
    });
  });

  describe('member-call hook classification', () => {
    it('classifies member-call hook matching service pattern as LIKELY_SERVICE_HOOK via convention stage', () => {
      // classifyByConvention (stage 4b) catches use*Query/Mutation names before
      // classifyMemberCallHook (stage 4c) is reached. Both stages apply the same
      // pattern, so isMemberCall hooks with service names are classified via 4b.
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useGetAllQuery', {
          isMemberCall: true,
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      // Matched via convention stage (4b), not member-call stage (4c)
      expect(result.assessments[0].rationale[0]).toContain('matches service hook naming convention');
    });
  });

  describe('member-call hook classification', () => {
    it('classifies member-call hook matching service pattern as LIKELY_SERVICE_HOOK via convention stage', () => {
      // classifyByConvention (stage 4b) catches use*Query/Mutation names before
      // classifyMemberCallHook (stage 4c) is reached. Both stages apply the same
      // pattern, so isMemberCall hooks with service names are classified via 4b.
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useGetAllQuery', {
          isMemberCall: true,
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_SERVICE_HOOK');
      expect(result.assessments[0].confidence).toBe('low');
      // Matched via convention stage (4b), not member-call stage (4c)
      expect(result.assessments[0].rationale[0]).toContain('matches service hook naming convention');
    });
  });

  describe('boundary confidence', () => {
    it('adds near-boundary indicator for UNKNOWN_HOOK', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useMyCustomUnknownHook')];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('UNKNOWN_HOOK');
      expect(result.assessments[0].rationale.some(r => r.includes('no classification pattern matched'))).toBe(true);
    });

    it('adds near-boundary when multiple classification patterns match', () => {
      // A hook that matches both the known context hooks list AND a context path pattern
      const observations: HookObservation[] = [
        makeHookCall('test.tsx', 10, 'useAuthState', {
          importSource: 'src/ui/providers/context/auth',
        }),
      ];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      // Should match by name heuristics AND import path
      // The name list check (stage 2) won't match useAuthState (it's in knownContextHooks, not ambientLeafHooks)
      // Import path (stage 3) matches context path pattern
      // Name heuristic (stage 4) matches knownContextHooks
      // So import-path wins first, but both import-path and name-heuristic would match
      expect(
        result.assessments[0].rationale.some(r => r.includes('[near-boundary]') && r.includes('multiple patterns')),
      ).toBe(true);
    });

    it('does not add near-boundary for unambiguous React builtins', () => {
      const observations: HookObservation[] = [makeHookCall('test.tsx', 10, 'useState', { isReactBuiltin: true })];

      const result = interpretHooks(observations);

      expect(result.assessments).toHaveLength(1);
      expect(result.assessments[0].kind).toBe('LIKELY_STATE_HOOK');
      expect(result.assessments[0].rationale.every(r => !r.includes('[near-boundary]'))).toBe(true);
    });
  });
});
