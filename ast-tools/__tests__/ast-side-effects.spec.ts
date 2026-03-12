import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeSideEffects } from '../ast-side-effects';
import type { SideEffectsAnalysis, SideEffectType } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): SideEffectsAnalysis {
  return analyzeSideEffects(fixturePath(name));
}

function effectsOfType(analysis: SideEffectsAnalysis, type: SideEffectType) {
  return analysis.sideEffects.filter(se => se.type === type);
}

describe('ast-side-effects', () => {
  const result = analyzeFixture('side-effects-samples.ts');

  describe('CONSOLE_CALL', () => {
    it('detects top-level console calls', () => {
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const topLevel = consoles.filter(c => c.containingFunction === '<module>');

      expect(topLevel).toHaveLength(3);
      expect(topLevel[0].line).toBe(5);
      expect(topLevel[0].text).toContain('console.log');
      expect(topLevel[1].line).toBe(6);
      expect(topLevel[2].line).toBe(7);
    });

    it('marks top-level console calls as not inside useEffect', () => {
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const topLevel = consoles.filter(c => c.containingFunction === '<module>');

      for (const c of topLevel) {
        expect(c.isInsideUseEffect).toBe(false);
      }
    });

    it('detects console inside useEffect with isInsideUseEffect: true', () => {
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const insideEffect = consoles.filter(c => c.isInsideUseEffect);

      expect(insideEffect.length).toBeGreaterThanOrEqual(2);
      expect(insideEffect[0].line).toBe(46);
      expect(insideEffect[0].containingFunction).toBe('MyComponent');
    });

    it('detects console.debug inside useLayoutEffect as inside useEffect', () => {
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const layoutEffect = consoles.find(c => c.line === 53);

      expect(layoutEffect).toBeDefined();
      expect(layoutEffect!.isInsideUseEffect).toBe(true);
    });

    it('detects console.info outside useEffect in component', () => {
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const outside = consoles.find(c => c.line === 57);

      expect(outside).toBeDefined();
      expect(outside!.isInsideUseEffect).toBe(false);
      expect(outside!.containingFunction).toBe('MyComponent');
    });
  });

  describe('TOAST_CALL', () => {
    it('detects toast calls in named function', () => {
      const toasts = effectsOfType(result, 'TOAST_CALL');

      expect(toasts).toHaveLength(3);
      expect(toasts[0].line).toBe(11);
      expect(toasts[0].containingFunction).toBe('showToast');
      expect(toasts[1].line).toBe(12);
      expect(toasts[2].line).toBe(13);
    });

    it('marks toast calls as not inside useEffect', () => {
      const toasts = effectsOfType(result, 'TOAST_CALL');

      for (const t of toasts) {
        expect(t.isInsideUseEffect).toBe(false);
      }
    });
  });

  describe('TIMER_CALL', () => {
    it('detects timer calls in named function', () => {
      const timers = effectsOfType(result, 'TIMER_CALL');
      const inStartTimers = timers.filter(t => t.containingFunction === 'startTimers');

      expect(inStartTimers).toHaveLength(6);
      expect(inStartTimers[0].line).toBe(18);
      expect(inStartTimers[0].text).toContain('setTimeout');
    });

    it('detects timers inside useEffect', () => {
      const timers = effectsOfType(result, 'TIMER_CALL');
      const insideEffect = timers.filter(t => t.isInsideUseEffect);

      expect(insideEffect.length).toBeGreaterThanOrEqual(2);
    });

    it('detects timers in nested functions inside useEffect', () => {
      const timers = effectsOfType(result, 'TIMER_CALL');
      const nestedClearInterval = timers.find(t => t.line === 66);

      expect(nestedClearInterval).toBeDefined();
      expect(nestedClearInterval!.isInsideUseEffect).toBe(true);
      expect(nestedClearInterval!.containingFunction).toBe('cleanup');
    });
  });

  describe('POSTHOG_CALL', () => {
    it('detects posthog calls in arrow function', () => {
      const posthog = effectsOfType(result, 'POSTHOG_CALL');

      expect(posthog).toHaveLength(4);
      expect(posthog[0].line).toBe(28);
      expect(posthog[0].containingFunction).toBe('trackEvents');
      expect(posthog[0].text).toContain('sendPosthogEvent');
    });

    it('detects posthog method calls', () => {
      const posthog = effectsOfType(result, 'POSTHOG_CALL');

      expect(posthog[1].text).toContain('posthog.capture');
      expect(posthog[2].text).toContain('posthog.identify');
      expect(posthog[3].text).toContain('posthog.reset');
    });
  });

  describe('WINDOW_MUTATION', () => {
    it('detects window mutation calls and assignments', () => {
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const inNavigateAway = mutations.filter(m => m.containingFunction === 'navigateAway');

      expect(inNavigateAway).toHaveLength(5);
      expect(inNavigateAway[0].line).toBe(36);
      expect(inNavigateAway[0].text).toContain('window.location');
    });

    it('detects document.title assignment inside useEffect', () => {
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const effectTitle = mutations.find(m => m.line === 48);

      expect(effectTitle).toBeDefined();
      expect(effectTitle!.isInsideUseEffect).toBe(true);
    });

    it('detects document.cookie assignment', () => {
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const cookie = mutations.find(m => m.line === 77);

      expect(cookie).toBeDefined();
      expect(cookie!.containingFunction).toBe('setCookie');
      expect(cookie!.text).toContain('document.cookie');
    });
  });

  describe('containingFunction', () => {
    it('uses <module> for top-level side effects', () => {
      const topLevel = result.sideEffects.filter(se => se.containingFunction === '<module>');

      expect(topLevel.length).toBeGreaterThan(0);
    });

    it('uses function name for named functions', () => {
      const inShowToast = result.sideEffects.filter(se => se.containingFunction === 'showToast');
      expect(inShowToast).toHaveLength(3);
    });

    it('uses variable name for arrow functions assigned to const', () => {
      const inTrackEvents = result.sideEffects.filter(se => se.containingFunction === 'trackEvents');
      expect(inTrackEvents).toHaveLength(4);
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual side effect counts', () => {
      const { summary, sideEffects } = result;

      for (const type of Object.keys(summary) as SideEffectType[]) {
        const count = sideEffects.filter(se => se.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for all expected types', () => {
      expect(result.summary.CONSOLE_CALL).toBeGreaterThan(0);
      expect(result.summary.TOAST_CALL).toBeGreaterThan(0);
      expect(result.summary.TIMER_CALL).toBeGreaterThan(0);
      expect(result.summary.POSTHOG_CALL).toBeGreaterThan(0);
      expect(result.summary.WINDOW_MUTATION).toBeGreaterThan(0);
    });
  });
});
