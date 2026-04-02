import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeSideEffects, analyzeSideEffectsDirectory, extractSideEffectObservations } from '../ast-side-effects';
import { getSourceFile } from '../project';
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
  describe('CONSOLE_CALL', () => {
    it('detects top-level console calls', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const topLevel = consoles.filter(c => c.containingFunction === '<module>');

      expect(topLevel).toHaveLength(3);
      expect(topLevel[0].line).toBe(5);
      expect(topLevel[0].text).toContain('console.log');
      expect(topLevel[1].line).toBe(6);
      expect(topLevel[2].line).toBe(7);
    });

    it('marks top-level console calls as not inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const topLevel = consoles.filter(c => c.containingFunction === '<module>');

      for (const c of topLevel) {
        expect(c.isInsideUseEffect).toBe(false);
      }
    });

    it('detects console inside useEffect with isInsideUseEffect: true', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const insideEffect = consoles.filter(c => c.isInsideUseEffect);

      expect(insideEffect.length).toBeGreaterThanOrEqual(2);
      expect(insideEffect[0].line).toBe(46);
      expect(insideEffect[0].containingFunction).toBe('MyComponent');
    });

    it('detects console.debug inside useLayoutEffect as inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const layoutEffect = consoles.find(c => c.line === 53);

      expect(layoutEffect).toBeDefined();
      expect(layoutEffect!.isInsideUseEffect).toBe(true);
    });

    it('detects console.info outside useEffect in component', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const consoles = effectsOfType(result, 'CONSOLE_CALL');
      const outside = consoles.find(c => c.line === 57);

      expect(outside).toBeDefined();
      expect(outside!.isInsideUseEffect).toBe(false);
      expect(outside!.containingFunction).toBe('MyComponent');
    });
  });

  describe('TOAST_CALL', () => {
    it('detects toast calls in named function', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const toasts = effectsOfType(result, 'TOAST_CALL');

      expect(toasts).toHaveLength(3);
      expect(toasts[0].line).toBe(11);
      expect(toasts[0].containingFunction).toBe('showToast');
      expect(toasts[1].line).toBe(12);
      expect(toasts[2].line).toBe(13);
    });

    it('marks toast calls as not inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const toasts = effectsOfType(result, 'TOAST_CALL');

      for (const t of toasts) {
        expect(t.isInsideUseEffect).toBe(false);
      }
    });
  });

  describe('TIMER_CALL', () => {
    it('detects timer calls in named function', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const timers = effectsOfType(result, 'TIMER_CALL');
      const inStartTimers = timers.filter(t => t.containingFunction === 'startTimers');

      expect(inStartTimers).toHaveLength(6);
      expect(inStartTimers[0].line).toBe(18);
      expect(inStartTimers[0].text).toContain('setTimeout');
    });

    it('detects timers inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const timers = effectsOfType(result, 'TIMER_CALL');
      const insideEffect = timers.filter(t => t.isInsideUseEffect);

      expect(insideEffect.length).toBeGreaterThanOrEqual(2);
    });

    it('detects timers in nested functions inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const timers = effectsOfType(result, 'TIMER_CALL');
      const nestedClearInterval = timers.find(t => t.line === 66);

      expect(nestedClearInterval).toBeDefined();
      expect(nestedClearInterval!.isInsideUseEffect).toBe(true);
      expect(nestedClearInterval!.containingFunction).toBe('cleanup');
    });
  });

  describe('POSTHOG_CALL', () => {
    it('detects posthog calls in arrow function', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const posthog = effectsOfType(result, 'POSTHOG_CALL');

      expect(posthog).toHaveLength(4);
      expect(posthog[0].line).toBe(28);
      expect(posthog[0].containingFunction).toBe('trackEvents');
      expect(posthog[0].text).toContain('sendPosthogEvent');
    });

    it('detects posthog method calls', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const posthog = effectsOfType(result, 'POSTHOG_CALL');

      expect(posthog[1].text).toContain('posthog.capture');
      expect(posthog[2].text).toContain('posthog.identify');
      expect(posthog[3].text).toContain('posthog.reset');
    });
  });

  describe('WINDOW_MUTATION', () => {
    it('detects window mutation calls and assignments', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const inNavigateAway = mutations.filter(m => m.containingFunction === 'navigateAway');

      expect(inNavigateAway).toHaveLength(5);
      expect(inNavigateAway[0].line).toBe(36);
      expect(inNavigateAway[0].text).toContain('window.location');
    });

    it('detects document.title assignment inside useEffect', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const effectTitle = mutations.find(m => m.line === 48);

      expect(effectTitle).toBeDefined();
      expect(effectTitle!.isInsideUseEffect).toBe(true);
    });

    it('detects document.cookie assignment', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const mutations = effectsOfType(result, 'WINDOW_MUTATION');
      const cookie = mutations.find(m => m.line === 77);

      expect(cookie).toBeDefined();
      expect(cookie!.containingFunction).toBe('setCookie');
      expect(cookie!.text).toContain('document.cookie');
    });
  });

  describe('containingFunction', () => {
    it('uses <module> for top-level side effects', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const topLevel = result.sideEffects.filter(se => se.containingFunction === '<module>');

      expect(topLevel.length).toBeGreaterThan(0);
    });

    it('uses function name for named functions', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const inShowToast = result.sideEffects.filter(se => se.containingFunction === 'showToast');
      expect(inShowToast).toHaveLength(3);
    });

    it('uses variable name for arrow functions assigned to const', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const inTrackEvents = result.sideEffects.filter(se => se.containingFunction === 'trackEvents');
      expect(inTrackEvents).toHaveLength(4);
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual side effect counts', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      const { summary, sideEffects } = result;

      for (const type of Object.keys(summary) as SideEffectType[]) {
        const count = sideEffects.filter(se => se.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for all expected types', () => {
      const result = analyzeFixture('side-effects-samples.ts');
      expect(result.summary.CONSOLE_CALL).toBeGreaterThan(0);
      expect(result.summary.TOAST_CALL).toBeGreaterThan(0);
      expect(result.summary.TIMER_CALL).toBeGreaterThan(0);
      expect(result.summary.POSTHOG_CALL).toBeGreaterThan(0);
      expect(result.summary.WINDOW_MUTATION).toBeGreaterThan(0);
    });
  });
});

describe('analyzeSideEffectsDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeSideEffectsDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });
});

describe('observations', () => {
  it('emits observations alongside legacy output', () => {
    const result = analyzeFixture('side-effects-samples.ts');
    expect(result.observations).toBeDefined();
    expect(Array.isArray(result.observations)).toBe(true);
    expect(result.observations.length).toBeGreaterThan(0);
  });

  it('observation count matches legacy sideEffects count', () => {
    const result = analyzeFixture('side-effects-samples.ts');
    expect(result.observations.length).toBe(result.sideEffects.length);
  });

  it('observations have kind matching SideEffectType', () => {
    const result = analyzeFixture('side-effects-samples.ts');
    const validKinds: SideEffectType[] = [
      'CONSOLE_CALL',
      'TOAST_CALL',
      'TIMER_CALL',
      'POSTHOG_CALL',
      'WINDOW_MUTATION',
    ];
    for (const obs of result.observations) {
      expect(validKinds).toContain(obs.kind);
    }
  });

  it('observations include evidence with isInsideUseEffect', () => {
    const result = analyzeFixture('side-effects-samples.ts');
    const withUseEffect = result.observations.filter(o => o.evidence.isInsideUseEffect === true);
    expect(withUseEffect.length).toBeGreaterThan(0);
  });

  it('observations include containingFunction in evidence', () => {
    const result = analyzeFixture('side-effects-samples.ts');
    for (const obs of result.observations) {
      expect(obs.evidence.containingFunction).toBeDefined();
    }
  });

  it('extractSideEffectObservations can be called directly', () => {
    const sf = getSourceFile(fixturePath('side-effects-samples.ts'));
    const observations = extractSideEffectObservations(sf);
    expect(observations.length).toBeGreaterThan(0);
  });
});

describe('posthog.people.set (nested property access)', () => {
  it('detects posthog.people.set as POSTHOG_CALL via legacy analyzeSideEffects', () => {
    const result = analyzeFixture('side-effects-posthog-people.ts');
    const posthog = effectsOfType(result, 'POSTHOG_CALL');
    expect(posthog).toHaveLength(1);
    expect(posthog[0].containingFunction).toBe('identifyUser');
    expect(posthog[0].text).toContain('posthog.people.set');
  });

  it('detects posthog.people.set as POSTHOG_CALL via extractSideEffectObservations', () => {
    const sf = getSourceFile(fixturePath('side-effects-posthog-people.ts'));
    const observations = extractSideEffectObservations(sf);
    expect(observations).toHaveLength(1);
    expect(observations[0].kind).toBe('POSTHOG_CALL');
    expect(observations[0].evidence.object).toBe('posthog.people');
    expect(observations[0].evidence.method).toBe('set');
  });
});

describe('negative fixture', () => {
  it('detects shadowed console calls on property access pattern', () => {
    const result = analyzeFixture('side-effects-negative.ts');
    const consoles = effectsOfType(result, 'CONSOLE_CALL');
    // Should detect shadowed console.log call
    expect(consoles.length).toBeGreaterThanOrEqual(1);
  });

  it('detects local toast function calls', () => {
    const result = analyzeFixture('side-effects-negative.ts');
    const toasts = effectsOfType(result, 'TOAST_CALL');
    // Local toast() function is detected (observation reports, interpreter decides)
    expect(toasts.length).toBeGreaterThanOrEqual(1);
  });

  it('detects setTimeout in test helper', () => {
    const result = analyzeFixture('side-effects-negative.ts');
    const timers = effectsOfType(result, 'TIMER_CALL');
    const testHelperTimer = timers.find(t => t.containingFunction === 'testHelper');
    expect(testHelperTimer).toBeDefined();
  });

  it('does NOT detect window.location.href read as WINDOW_MUTATION', () => {
    const result = analyzeFixture('side-effects-negative.ts');
    const mutations = effectsOfType(result, 'WINDOW_MUTATION');
    // Reads should NOT be detected, only assignments
    const urlRead = mutations.find(m => m.text.includes('url =') || m.text.includes('pathname ='));
    expect(urlRead).toBeUndefined();
  });

  it('does NOT detect console object property access (not a call)', () => {
    const result = analyzeFixture('side-effects-negative.ts');
    const consoles = effectsOfType(result, 'CONSOLE_CALL');
    // Should NOT detect: const logMethod = console.log
    const propAccess = consoles.find(c => c.text.includes('logMethod'));
    expect(propAccess).toBeUndefined();
  });
});
