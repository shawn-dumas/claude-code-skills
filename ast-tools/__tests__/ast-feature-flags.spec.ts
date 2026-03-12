import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeFeatureFlags } from '../ast-feature-flags';
import type { FeatureFlagAnalysis, FeatureFlagUsageType } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): FeatureFlagAnalysis {
  return analyzeFeatureFlags(fixturePath(name));
}

function usagesOfType(analysis: FeatureFlagAnalysis, type: FeatureFlagUsageType) {
  return analysis.usages.filter(u => u.type === type);
}

describe('ast-feature-flags', () => {
  const result = analyzeFixture('feature-flag-samples.tsx');

  describe('FLAG_HOOK_CALL', () => {
    it('detects usePosthogContext with featureFlags destructured', () => {
      const hookCalls = usagesOfType(result, 'FLAG_HOOK_CALL');
      const posthogCall = hookCalls.find(u => u.text.includes('usePosthogContext'));

      expect(posthogCall).toBeDefined();
      expect(posthogCall!.flagName).toBeNull();
      expect(posthogCall!.containingFunction).toBe('DashboardContainer');
    });

    it('detects useFeatureFlags direct call', () => {
      const hookCalls = usagesOfType(result, 'FLAG_HOOK_CALL');
      const directCall = hookCalls.find(u => u.text.includes('useFeatureFlags'));

      expect(directCall).toBeDefined();
      expect(directCall!.flagName).toBeNull();
      expect(directCall!.containingFunction).toBe('SettingsContainer');
    });
  });

  describe('FLAG_READ', () => {
    it('detects property access on featureFlags', () => {
      const flagReads = usagesOfType(result, 'FLAG_READ');

      expect(flagReads.length).toBeGreaterThanOrEqual(1);

      const insightsRead = flagReads.find(u => u.flagName === 'insights_chat_enabled');
      expect(insightsRead).toBeDefined();
      expect(insightsRead!.containingFunction).toBe('DashboardContainer');
    });

    it('detects flag reads in separate containers', () => {
      const flagReads = usagesOfType(result, 'FLAG_READ');
      const analyzerRead = flagReads.find(u => u.flagName === 'analyzer_insights_enabled');

      expect(analyzerRead).toBeDefined();
      expect(analyzerRead!.containingFunction).toBe('SettingsContainer');
    });
  });

  describe('PAGE_GUARD', () => {
    it('detects useFeatureFlagPageGuard with flag name', () => {
      const pageGuards = usagesOfType(result, 'PAGE_GUARD');

      expect(pageGuards.length).toBeGreaterThanOrEqual(1);
      expect(pageGuards[0].flagName).toBe('enable_realtime_insights');
      expect(pageGuards[0].containingFunction).toBe('DashboardContainer');
    });
  });

  describe('NAV_TAB_GATE', () => {
    it('detects object literals with featureFlag property', () => {
      const navGates = usagesOfType(result, 'NAV_TAB_GATE');

      expect(navGates.length).toBeGreaterThanOrEqual(2);

      const flagNames = navGates.map(u => u.flagName);
      expect(flagNames).toContain('systems_insights_enabled');
      expect(flagNames).toContain('relay_usage_insights_enabled');
    });
  });

  describe('CONDITIONAL_RENDER', () => {
    it('detects ternary on featureFlags in JSX', () => {
      const conditionals = usagesOfType(result, 'CONDITIONAL_RENDER');
      const ternary = conditionals.find(u => u.flagName === 'systems_insights_enabled');

      expect(ternary).toBeDefined();
      expect(ternary!.containingFunction).toBe('DashboardContainer');
    });

    it('detects && guard on featureFlags in JSX', () => {
      const conditionals = usagesOfType(result, 'CONDITIONAL_RENDER');
      const andGuard = conditionals.find(u => u.flagName === 'enable_details');

      expect(andGuard).toBeDefined();
      expect(andGuard!.containingFunction).toBe('DashboardContainer');
    });
  });

  describe('FLAG_OVERRIDE', () => {
    it('detects __setFeatureFlags call', () => {
      const overrides = usagesOfType(result, 'FLAG_OVERRIDE');
      const setCall = overrides.find(u => u.text.includes('__setFeatureFlags'));

      expect(setCall).toBeDefined();
      expect(setCall!.flagName).toBeNull();
    });

    it('detects __clearFeatureFlags call', () => {
      const overrides = usagesOfType(result, 'FLAG_OVERRIDE');
      const clearCall = overrides.find(u => u.text.includes('__clearFeatureFlags'));

      expect(clearCall).toBeDefined();
      expect(clearCall!.flagName).toBeNull();
    });
  });

  describe('flagsReferenced', () => {
    it('contains unique sorted list of all flag names', () => {
      expect(result.flagsReferenced).toEqual(
        expect.arrayContaining([
          'analyzer_insights_enabled',
          'enable_details',
          'enable_realtime_insights',
          'insights_chat_enabled',
          'relay_usage_insights_enabled',
          'systems_insights_enabled',
        ]),
      );

      // Verify sorted
      const sorted = [...result.flagsReferenced].sort();
      expect(result.flagsReferenced).toEqual(sorted);
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual usage counts', () => {
      const { summary, usages } = result;

      for (const type of Object.keys(summary) as FeatureFlagUsageType[]) {
        const count = usages.filter(u => u.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for all expected usage types', () => {
      expect(result.summary.FLAG_HOOK_CALL).toBeGreaterThan(0);
      expect(result.summary.FLAG_READ).toBeGreaterThan(0);
      expect(result.summary.PAGE_GUARD).toBeGreaterThan(0);
      expect(result.summary.NAV_TAB_GATE).toBeGreaterThan(0);
      expect(result.summary.CONDITIONAL_RENDER).toBeGreaterThan(0);
      expect(result.summary.FLAG_OVERRIDE).toBeGreaterThan(0);
    });
  });

  describe('no double counting', () => {
    it('flags used in JSX conditionals are not also counted as FLAG_READ', () => {
      const flagReads = usagesOfType(result, 'FLAG_READ');
      const conditionals = usagesOfType(result, 'CONDITIONAL_RENDER');

      // For each FLAG_READ, check it is not on the same line as a CONDITIONAL_RENDER
      for (const read of flagReads) {
        const sameLineConditional = conditionals.find(c => c.line === read.line && c.flagName === read.flagName);
        expect(
          sameLineConditional,
          `FLAG_READ for ${read.flagName} at line ${read.line} should not duplicate a CONDITIONAL_RENDER`,
        ).toBeUndefined();
      }
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real project file without crashing', () => {
      const realResult = analyzeFeatureFlags('src/shared/hooks/useFeatureFlags/types.ts');

      expect(realResult.filePath).toContain('useFeatureFlags');
      expect(realResult.usages).toBeDefined();
      expect(realResult.summary).toBeDefined();

      // Verify all summary keys exist
      const expectedKeys: FeatureFlagUsageType[] = [
        'FLAG_HOOK_CALL',
        'FLAG_READ',
        'PAGE_GUARD',
        'NAV_TAB_GATE',
        'CONDITIONAL_RENDER',
        'FLAG_OVERRIDE',
      ];
      for (const key of expectedKeys) {
        expect(realResult.summary).toHaveProperty(key);
        expect(typeof realResult.summary[key]).toBe('number');
      }
    });
  });
});
