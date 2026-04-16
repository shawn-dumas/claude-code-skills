import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeReactFile } from '../ast-react-inventory';
import type { ReactInventory } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ReactInventory {
  return analyzeReactFile(fixturePath(name));
}

describe('ast-react-inventory', () => {
  describe('simple component', () => {
    it('detects a function component with named props interface', () => {
      const result = analyzeFixture('simple-component.tsx');

      expect(result.components).toHaveLength(1);
      expect(result.components[0].name).toBe('Button');
      expect(result.components[0].kind).toBe('function');
      expect(result.components[0].hookCalls).toHaveLength(0);
      expect(result.components[0].useEffects).toHaveLength(0);
    });

    it('extracts props with types, optional, default, and callback flags', () => {
      const result = analyzeFixture('simple-component.tsx');
      const props = result.components[0].props;

      expect(props).toHaveLength(3);

      const label = props.find(p => p.name === 'label');
      expect(label).toEqual({
        name: 'label',
        type: 'string',
        optional: false,
        hasDefault: false,
        isCallback: false,
      });

      const onClick = props.find(p => p.name === 'onClick');
      expect(onClick).toEqual({
        name: 'onClick',
        type: '() => void',
        optional: false,
        hasDefault: false,
        isCallback: true,
      });

      const disabled = props.find(p => p.name === 'disabled');
      expect(disabled).toEqual({
        name: 'disabled',
        type: 'boolean',
        optional: true,
        hasDefault: true,
        isCallback: false,
      });
    });

    it('reports return statement lines', () => {
      const result = analyzeFixture('simple-component.tsx');
      const comp = result.components[0];

      expect(comp.returnStatementLine).toBeGreaterThan(0);
      expect(comp.returnStatementEndLine).toBeGreaterThanOrEqual(comp.returnStatementLine);
    });
  });

  describe('component with effects', () => {
    it('detects all useEffect calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];

      expect(comp.name).toBe('Timer');
      expect(comp.useEffects).toHaveLength(4);
    });

    it('extracts dependency arrays correctly', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const effects = result.components[0].useEffects;

      // First effect: [initialCount]
      expect(effects[0].depArray).toEqual(['initialCount']);

      // Second effect: [] (empty deps)
      expect(effects[1].depArray).toEqual([]);

      // Third effect: [count, onTick]
      expect(effects[2].depArray).toEqual(['count', 'onTick']);

      // Fourth effect: [count]
      expect(effects[3].depArray).toEqual(['count']);
    });

    it('detects cleanup functions', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const effects = result.components[0].useEffects;

      expect(effects[0].hasCleanup).toBe(false);
      expect(effects[1].hasCleanup).toBe(true); // clearInterval cleanup
      expect(effects[2].hasCleanup).toBe(false);
      expect(effects[3].hasCleanup).toBe(false);
    });

    it('analyzes effect bodies for setState calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const effects = result.components[0].useEffects;

      // First effect: setCount(initialCount)
      expect(effects[0].bodyAnalysis.callsSetState).toBe(true);
      expect(effects[0].bodyAnalysis.stateSetters).toContain('setCount');

      // Second effect: setCount in interval
      expect(effects[1].bodyAnalysis.callsSetState).toBe(true);
      expect(effects[1].bodyAnalysis.stateSetters).toContain('setCount');
    });

    it('analyzes effect bodies for fetch calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const effects = result.components[0].useEffects;

      // Fourth effect: fetch('/api/log', ...)
      expect(effects[3].bodyAnalysis.callsFetch).toBe(true);

      // Other effects should not have fetch
      expect(effects[0].bodyAnalysis.callsFetch).toBe(false);
      expect(effects[1].bodyAnalysis.callsFetch).toBe(false);
    });

    it('analyzes effect bodies for timers', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const effects = result.components[0].useEffects;

      // Second effect: setInterval
      expect(effects[1].bodyAnalysis.hasTimers).toBe(true);

      // Others should not have timers
      expect(effects[0].bodyAnalysis.hasTimers).toBe(false);
    });

    it('reports hook calls including useState, useRef, and useEffect', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const hookNames = result.components[0].hookCalls.map(h => h.name);

      expect(hookNames).toContain('useState');
      expect(hookNames).toContain('useRef');
      expect(hookNames).toContain('useEffect');
    });

    it('reports built-in hooks without classification (observation-only)', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      for (const hook of result.components[0].hookCalls) {
        // HookCall no longer has classification field -- that's now handled by interpreters
        expect(hook).not.toHaveProperty('classification');
      }
    });

    it('extracts destructured names from useState', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const useStateHook = result.components[0].hookCalls.find(h => h.name === 'useState');
      expect(useStateHook).toBeDefined();
      expect(useStateHook!.destructuredNames).toEqual(['count', 'setCount']);
    });
  });

  describe('hook extraction (observation-only, no classification)', () => {
    it('extracts hooks without classification -- classification is now done by interpreters', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      expect(comp).toBeDefined();

      // Verify hooks are detected
      const authHook = comp!.hookCalls.find(h => h.name === 'useAuthState');
      expect(authHook).toBeDefined();

      const useStateHook = comp!.hookCalls.find(h => h.name === 'useState');
      expect(useStateHook).toBeDefined();

      const memoHook = comp!.hookCalls.find(h => h.name === 'useMemo');
      expect(memoHook).toBeDefined();

      const callbackHook = comp!.hookCalls.find(h => h.name === 'useCallback');
      expect(callbackHook).toBeDefined();

      const breakpoints = comp!.hookCalls.find(h => h.name === 'useBreakpoints');
      expect(breakpoints).toBeDefined();

      const scoped = comp!.hookCalls.find(h => h.name === 'useFilterScope');
      expect(scoped).toBeDefined();

      // None should have classification -- that field was removed
      for (const hook of comp!.hookCalls) {
        expect(hook).not.toHaveProperty('classification');
      }
    });
  });

  describe('props extraction', () => {
    it('extracts props from inline type literal', () => {
      const result = analyzeFixture('props-extraction.tsx');
      const comp = result.components.find(c => c.name === 'InlineComponent');
      expect(comp).toBeDefined();
      expect(comp!.props).toHaveLength(2);

      const label = comp!.props.find(p => p.name === 'label');
      expect(label).toBeDefined();
      expect(label!.type).toBe('string');
      expect(label!.optional).toBe(false);

      const count = comp!.props.find(p => p.name === 'count');
      expect(count).toBeDefined();
      expect(count!.type).toBe('number');
      expect(count!.optional).toBe(true);
      expect(count!.hasDefault).toBe(true);
    });

    it('extracts props from named interface', () => {
      const result = analyzeFixture('props-extraction.tsx');
      const comp = result.components.find(c => c.name === 'NamedComponent');
      expect(comp).toBeDefined();
      expect(comp!.props).toHaveLength(2);

      const names = comp!.props.map(p => p.name);
      expect(names).toContain('id');
      expect(names).toContain('name');
    });

    it('extracts props from extended interface (includes base fields)', () => {
      const result = analyzeFixture('props-extraction.tsx');
      const comp = result.components.find(c => c.name === 'ExtendedComponent');
      expect(comp).toBeDefined();

      const names = comp!.props.map(p => p.name);
      // Should include base (id, name) and own (email, onSave)
      expect(names).toContain('id');
      expect(names).toContain('name');
      expect(names).toContain('email');
      expect(names).toContain('onSave');
    });

    it('extracts props from intersection type (merges all parts)', () => {
      const result = analyzeFixture('props-extraction.tsx');
      const comp = result.components.find(c => c.name === 'CombinedComponent');
      expect(comp).toBeDefined();

      const names = comp!.props.map(p => p.name);
      // From ExtendedProps (and BaseProps)
      expect(names).toContain('id');
      expect(names).toContain('name');
      expect(names).toContain('email');
      expect(names).toContain('onSave');
      // From the inline intersection part
      expect(names).toContain('isActive');
      expect(names).toContain('children');
    });

    it('detects callback props by type or naming convention', () => {
      const result = analyzeFixture('props-extraction.tsx');
      const comp = result.components.find(c => c.name === 'ExtendedComponent');
      expect(comp).toBeDefined();

      const onSave = comp!.props.find(p => p.name === 'onSave');
      expect(onSave).toBeDefined();
      expect(onSave!.isCallback).toBe(true);

      const id = comp!.props.find(p => p.name === 'id');
      expect(id!.isCallback).toBe(false);
    });
  });

  describe('multiple components', () => {
    it('detects all components in a multi-component file', () => {
      const result = analyzeFixture('multiple-components.tsx');

      const names = result.components.map(c => c.name);
      expect(names).toContain('StatusBadge');
      expect(names).toContain('Container');
      expect(names).toContain('ContentBlock');
      expect(names).toContain('MemoCard');
      expect(names).toContain('InputField');
    });

    it('classifies component kinds correctly', () => {
      const result = analyzeFixture('multiple-components.tsx');

      const findComp = (name: string) => result.components.find(c => c.name === name);

      expect(findComp('StatusBadge')!.kind).toBe('function');
      expect(findComp('Container')!.kind).toBe('function');
      expect(findComp('ContentBlock')!.kind).toBe('function');
      expect(findComp('MemoCard')!.kind).toBe('memo');
      expect(findComp('InputField')!.kind).toBe('forwardRef');
    });

    it('reports hook calls per component', () => {
      const result = analyzeFixture('multiple-components.tsx');

      const container = result.components.find(c => c.name === 'Container');
      expect(container).toBeDefined();
      const containerHookNames = container!.hookCalls.map(h => h.name);
      expect(containerHookNames).toContain('useState');
      expect(containerHookNames).toContain('useCallback');
      expect(containerHookNames).toContain('useMemo');

      // Leaf components should have no hooks
      const leaf = result.components.find(c => c.name === 'ContentBlock');
      expect(leaf!.hookCalls).toHaveLength(0);
    });

    it('extracts forwardRef component props from generic type args', () => {
      const result = analyzeFixture('multiple-components.tsx');
      const inputField = result.components.find(c => c.name === 'InputField');
      expect(inputField).toBeDefined();

      const names = inputField!.props.map(p => p.name);
      expect(names).toContain('label');
      expect(names).toContain('onChange');

      const onChange = inputField!.props.find(p => p.name === 'onChange');
      expect(onChange!.isCallback).toBe(true);
    });
  });

  describe('hook definitions', () => {
    it('lists custom hooks defined in the file', () => {
      const result = analyzeFixture('multiple-components.tsx');
      expect(result.hookDefinitions).toContain('useLocalFilter');
    });

    it('does not list components as hook definitions', () => {
      const result = analyzeFixture('multiple-components.tsx');
      expect(result.hookDefinitions).not.toContain('Container');
      expect(result.hookDefinitions).not.toContain('ContentBlock');
    });

    it('lists hook definitions from hook-classification fixture', () => {
      const result = analyzeFixture('hook-classification.tsx');
      expect(result.hookDefinitions).toContain('useAuthState');
      expect(result.hookDefinitions).toContain('useTeamsHostTimeQuery');
      expect(result.hookDefinitions).toContain('useBreakpoints');
      expect(result.hookDefinitions).toContain('useFilterScope');
    });
  });

  describe('pure-TS custom hooks (no JSX return)', () => {
    it('emits ComponentInfo entries with kind=hook for top-level useXxx functions', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      const hookBodies = result.components.filter(c => c.kind === 'hook');

      expect(hookBodies.map(c => c.name).sort()).toEqual(['useArrowHook', 'useExampleHook']);
    });

    it('detects useEffect + useLayoutEffect inside function-declaration hook body', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      const hook = result.components.find(c => c.name === 'useExampleHook');

      expect(hook).toBeDefined();
      const effectHooks = hook!.hookCalls.filter(h => h.name === 'useEffect' || h.name === 'useLayoutEffect');
      expect(effectHooks.map(h => h.name).sort()).toEqual(['useEffect', 'useLayoutEffect']);
      expect(hook!.useEffects.length).toBeGreaterThanOrEqual(2);
    });

    it('detects useMemo + useCallback inside hook body', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      const hook = result.components.find(c => c.name === 'useExampleHook');

      const names = hook!.hookCalls.map(h => h.name);
      expect(names).toContain('useMemo');
      expect(names).toContain('useCallback');
    });

    it('detects useEffect inside arrow-function hook body', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      const hook = result.components.find(c => c.name === 'useArrowHook');

      expect(hook).toBeDefined();
      expect(hook!.kind).toBe('hook');
      const effectHooks = hook!.hookCalls.filter(h => h.name === 'useEffect');
      expect(effectHooks).toHaveLength(1);
    });

    it('emits HOOK_CALL observations for hook-body hooks', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      const useEffectObs = result.hookObservations.filter(
        o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useEffect',
      );
      // useExampleHook contributes one, useArrowHook contributes one.
      expect(useEffectObs.length).toBeGreaterThanOrEqual(2);
    });

    it('hookDefinitions still lists the hook names for back-compat', () => {
      const result = analyzeFixture('pure-ts-hook.ts');
      expect(result.hookDefinitions).toContain('useExampleHook');
      expect(result.hookDefinitions).toContain('useArrowHook');
    });
  });

  describe('output structure', () => {
    it('conforms to ReactInventory interface', () => {
      const result = analyzeFixture('simple-component.tsx');

      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('components');
      expect(result).toHaveProperty('hookDefinitions');

      expect(typeof result.filePath).toBe('string');
      expect(Array.isArray(result.components)).toBe(true);
      expect(Array.isArray(result.hookDefinitions)).toBe(true);
    });

    it('each component has all required fields', () => {
      const result = analyzeFixture('component-with-effects.tsx');

      for (const comp of result.components) {
        expect(comp).toHaveProperty('name');
        expect(comp).toHaveProperty('line');
        expect(comp).toHaveProperty('kind');
        expect(comp).toHaveProperty('props');
        expect(comp).toHaveProperty('hookCalls');
        expect(comp).toHaveProperty('useEffects');
        expect(comp).toHaveProperty('returnStatementLine');
        expect(comp).toHaveProperty('returnStatementEndLine');
      }
    });

    it('each hook call has all required fields', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];

      for (const hook of comp.hookCalls) {
        expect(hook).toHaveProperty('name');
        expect(hook).toHaveProperty('line');
        expect(hook).toHaveProperty('column');
        expect(hook).toHaveProperty('parentFunction');
        expect(hook).toHaveProperty('destructuredNames');
        // classification was removed -- now handled by interpreters
        expect(hook).not.toHaveProperty('classification');
        expect(typeof hook.line).toBe('number');
        expect(typeof hook.column).toBe('number');
      }
    });

    it('each useEffect has all required fields', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];

      for (const effect of comp.useEffects) {
        expect(effect).toHaveProperty('line');
        expect(effect).toHaveProperty('parentFunction');
        expect(effect).toHaveProperty('depArray');
        expect(effect).toHaveProperty('hasCleanup');
        expect(effect).toHaveProperty('bodyAnalysis');
        expect(effect.bodyAnalysis).toHaveProperty('callsSetState');
        expect(effect.bodyAnalysis).toHaveProperty('stateSetters');
        expect(effect.bodyAnalysis).toHaveProperty('callsFetch');
        expect(effect.bodyAnalysis).toHaveProperty('callsNavigation');
        expect(effect.bodyAnalysis).toHaveProperty('callsStorage');
        expect(effect.bodyAnalysis).toHaveProperty('callsToast');
        expect(effect.bodyAnalysis).toHaveProperty('hasTimers');
      }
    });

    it('output is JSON-serializable', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('effect observations', () => {
    it('emits EFFECT_LOCATION for each useEffect', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const locations = comp.effectObservations.filter(o => o.kind === 'EFFECT_LOCATION');

      // Timer component has 4 useEffects
      expect(locations).toHaveLength(4);
      for (const loc of locations) {
        expect(loc.evidence.parentFunction).toBe('Timer');
        expect(loc.evidence.effectLine).toBeGreaterThan(0);
      }
    });

    it('emits EFFECT_DEP_ENTRY for each dependency', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const depEntries = comp.effectObservations.filter(o => o.kind === 'EFFECT_DEP_ENTRY');

      // First effect: [initialCount] -> 1 dep
      // Second effect: [] -> 0 deps
      // Third effect: [count, onTick] -> 2 deps
      // Fourth effect: [count] -> 1 dep
      // Total: 4 deps
      expect(depEntries).toHaveLength(4);
      expect(depEntries.some(e => e.evidence.identifier === 'initialCount')).toBe(true);
      expect(depEntries.some(e => e.evidence.identifier === 'count')).toBe(true);
      expect(depEntries.some(e => e.evidence.identifier === 'onTick')).toBe(true);
    });

    it('emits EFFECT_CLEANUP_PRESENT for effects with cleanup', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const cleanups = comp.effectObservations.filter(o => o.kind === 'EFFECT_CLEANUP_PRESENT');

      // Only the second effect has cleanup (clearInterval)
      expect(cleanups).toHaveLength(1);
    });

    it('emits EFFECT_STATE_SETTER_CALL for setState calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const setterCalls = comp.effectObservations.filter(o => o.kind === 'EFFECT_STATE_SETTER_CALL');

      // First effect: setCount(initialCount)
      // Second effect: setCount in interval callback
      // Both should emit state setter observations
      expect(setterCalls.length).toBeGreaterThanOrEqual(2);
      expect(setterCalls.every(s => s.evidence.identifier === 'setCount')).toBe(true);
    });

    it('emits EFFECT_FETCH_CALL for fetch calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const fetchCalls = comp.effectObservations.filter(o => o.kind === 'EFFECT_FETCH_CALL');

      // Fourth effect: fetch('/api/log', ...)
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].evidence.identifier).toBe('fetch');
    });

    it('emits EFFECT_TIMER_CALL for timer calls', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const timerCalls = comp.effectObservations.filter(o => o.kind === 'EFFECT_TIMER_CALL');

      // Second effect: setInterval
      expect(timerCalls).toHaveLength(1);
      expect(timerCalls[0].evidence.identifier).toBe('setInterval');
    });

    it('emits EFFECT_PROP_READ for prop reads in effect', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];
      const propReads = comp.effectObservations.filter(o => o.kind === 'EFFECT_PROP_READ');

      // Effects read initialCount, onTick, count
      // initialCount and onTick are props
      const propNames = propReads.map(p => p.evidence.identifier);
      expect(propNames).toContain('initialCount');
      expect(propNames).toContain('onTick');
    });

    it('preserves backward compatibility with useEffects field', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const comp = result.components[0];

      // useEffects should still be populated with old format
      expect(comp.useEffects).toHaveLength(4);
      expect(comp.useEffects[0]).toHaveProperty('bodyAnalysis');
      expect(comp.useEffects[0].bodyAnalysis).toHaveProperty('callsSetState');
      expect(comp.useEffects[0].bodyAnalysis).toHaveProperty('stateSetters');

      // Both fields should be present
      expect(comp.effectObservations).toBeDefined();
      expect(Array.isArray(comp.effectObservations)).toBe(true);
    });
  });

  describe('effect observations - negative cases', () => {
    it('does not emit EFFECT_FETCH_CALL for indirect fetch (helper wrapper)', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'IndirectFetch');
      expect(comp).toBeDefined();

      const fetchCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_FETCH_CALL');
      // The refetch() call is NOT a direct fetch, so no EFFECT_FETCH_CALL
      expect(fetchCalls).toHaveLength(0);
    });

    it('emits EFFECT_STATE_SETTER_CALL for nested setData in .then chain', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'NestedSetState');
      expect(comp).toBeDefined();

      const setterCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_STATE_SETTER_CALL');
      expect(setterCalls.some(s => s.evidence.identifier === 'setData')).toBe(true);
    });

    it('emits EFFECT_STORAGE_CALL for shadowed localStorage (known limitation)', () => {
      // Note: AST tool cannot distinguish shadowed variables from globals
      // without full scope analysis. This documents the limitation.
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'ShadowedStorage');
      expect(comp).toBeDefined();

      const storageCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_STORAGE_CALL');
      // Will emit because we see localStorage.getItem() syntactically
      expect(storageCalls).toHaveLength(1);
    });

    it('has no effect observations for component without useEffect', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'TimerOutsideEffect');
      expect(comp).toBeDefined();

      // No useEffect in this component, so no effect observations
      expect(comp!.effectObservations).toHaveLength(0);
    });

    it('has no EFFECT_REF_TOUCH for ref access outside effect', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'RefOutsideEffect');
      expect(comp).toBeDefined();

      // Ref is accessed in measure() function, not in an effect
      const refTouches = comp!.effectObservations.filter(o => o.kind === 'EFFECT_REF_TOUCH');
      expect(refTouches).toHaveLength(0);
    });

    it('emits only EFFECT_LOCATION for empty effect', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'EmptyEffect');
      expect(comp).toBeDefined();

      // Only EFFECT_LOCATION should be emitted for empty effect
      expect(comp!.effectObservations.filter(o => o.kind === 'EFFECT_LOCATION')).toHaveLength(1);
      expect(comp!.effectObservations.filter(o => o.kind !== 'EFFECT_LOCATION')).toHaveLength(0);
    });

    it('does not track aliased setter (known limitation)', () => {
      // Known limitation: aliased setters are not tracked
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'AliasedSetter');
      expect(comp).toBeDefined();

      const setterCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_STATE_SETTER_CALL');
      // update(1) is NOT detected as setCount because alias is not resolved
      expect(setterCalls.some(s => s.evidence.identifier === 'setCount')).toBe(false);
      expect(setterCalls.some(s => s.evidence.identifier === 'update')).toBe(false);
    });

    it('detects useLayoutEffect same as useEffect', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'LayoutEffect');
      expect(comp).toBeDefined();

      const locations = comp!.effectObservations.filter(o => o.kind === 'EFFECT_LOCATION');
      expect(locations).toHaveLength(1);
    });

    it('emits EFFECT_ASYNC_CALL for async function in effect', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'AsyncEffect');
      expect(comp).toBeDefined();

      const asyncCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_ASYNC_CALL');
      expect(asyncCalls.length).toBeGreaterThan(0);
    });

    it('emits EFFECT_DOM_API for window.addEventListener', () => {
      const result = analyzeFixture('effect-negative.tsx');
      const comp = result.components.find(c => c.name === 'DomApiEffect');
      expect(comp).toBeDefined();

      const domCalls = comp!.effectObservations.filter(o => o.kind === 'EFFECT_DOM_API');
      expect(domCalls.length).toBeGreaterThan(0);
      expect(domCalls.some(d => d.evidence.targetObject === 'window')).toBe(true);
    });
  });

  describe('real file smoke test', () => {
    it('analyzes ProductivityContainer.tsx and produces valid output', () => {
      const result = analyzeReactFile('src/ui/page_blocks/dashboard/team/ProductivityContainer.tsx');

      expect(result.filePath).toContain('ProductivityContainer.tsx');
      expect(result.components.length).toBeGreaterThan(0);

      const container = result.components[0];
      expect(container.name).toBe('ProductivityContainer');
      expect(container.hookCalls.length).toBeGreaterThan(0);

      // Should have hooks detected (classification is now done by interpreters)
      const serviceHook = container.hookCalls.find(h => h.name === 'useTeamsHostTimeQuery');
      expect(serviceHook).toBeDefined();
      expect(serviceHook).not.toHaveProperty('classification');

      const memoHooks = container.hookCalls.filter(h => h.name === 'useMemo');
      expect(memoHooks.length).toBeGreaterThan(0);
      for (const h of memoHooks) {
        expect(h).not.toHaveProperty('classification');
      }

      // Output should be serializable
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('hook observations', () => {
    it('emits HOOK_CALL observations without classification', () => {
      const result = analyzeFixture('hook-classification.tsx');

      // File-level hook observations
      expect(result.hookObservations).toBeDefined();
      expect(result.hookObservations.length).toBeGreaterThan(0);

      // All observations should be HOOK_CALL
      const hookCalls = result.hookObservations.filter(o => o.kind === 'HOOK_CALL');
      expect(hookCalls.length).toBeGreaterThan(0);

      // Observations should NOT have classification - that's the interpreter's job
      for (const obs of hookCalls) {
        expect(obs.evidence).not.toHaveProperty('classification');
        expect(obs.evidence).toHaveProperty('hookName');
        expect(obs.evidence).toHaveProperty('isReactBuiltin');
      }
    });

    it('marks React builtin hooks with isReactBuiltin: true', () => {
      const result = analyzeFixture('hook-classification.tsx');

      const useStateObs = result.hookObservations.find(
        o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useState',
      );
      expect(useStateObs).toBeDefined();
      expect(useStateObs!.evidence.isReactBuiltin).toBe(true);

      const useMemoObs = result.hookObservations.find(o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useMemo');
      expect(useMemoObs).toBeDefined();
      expect(useMemoObs!.evidence.isReactBuiltin).toBe(true);
    });

    it('marks custom hooks with isReactBuiltin: false', () => {
      const result = analyzeFixture('hook-classification.tsx');

      const useAuthStateObs = result.hookObservations.find(
        o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useAuthState',
      );
      expect(useAuthStateObs).toBeDefined();
      expect(useAuthStateObs!.evidence.isReactBuiltin).toBe(false);
    });

    it('captures destructuredNames in hook observations', () => {
      const result = analyzeFixture('hook-classification.tsx');

      const useStateObs = result.hookObservations.find(
        o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useState',
      );
      expect(useStateObs).toBeDefined();
      expect(useStateObs!.evidence.destructuredNames).toEqual(['count', 'setCount']);
    });

    it('captures parentFunction in hook observations', () => {
      const result = analyzeFixture('hook-classification.tsx');

      const hookCalls = result.hookObservations.filter(o => o.kind === 'HOOK_CALL');
      const fromClassifiedComponent = hookCalls.filter(o => o.evidence.parentFunction === 'ClassifiedComponent');
      expect(fromClassifiedComponent.length).toBeGreaterThan(0);
    });

    it('HookCall no longer has classification field (observation-only)', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      expect(comp).toBeDefined();

      // HookCall no longer has classification -- that's the interpreter's job
      for (const hook of comp!.hookCalls) {
        expect(hook).not.toHaveProperty('classification');
      }
    });
  });

  describe('component observations', () => {
    it('emits COMPONENT_DECLARATION for each component', () => {
      const result = analyzeFixture('multiple-components.tsx');

      const compDecls = result.componentObservations.filter(o => o.kind === 'COMPONENT_DECLARATION');
      const compNames = compDecls.map(o => o.evidence.componentName);

      expect(compNames).toContain('StatusBadge');
      expect(compNames).toContain('Container');
      expect(compNames).toContain('ContentBlock');
      expect(compNames).toContain('MemoCard');
      expect(compNames).toContain('InputField');
    });

    it('captures component kind in COMPONENT_DECLARATION', () => {
      const result = analyzeFixture('multiple-components.tsx');

      const compDecls = result.componentObservations.filter(o => o.kind === 'COMPONENT_DECLARATION');

      const memoCard = compDecls.find(o => o.evidence.componentName === 'MemoCard');
      expect(memoCard).toBeDefined();
      expect(memoCard!.evidence.kind).toBe('memo');

      const inputField = compDecls.find(o => o.evidence.componentName === 'InputField');
      expect(inputField).toBeDefined();
      expect(inputField!.evidence.kind).toBe('forwardRef');
    });

    it('emits PROP_FIELD for each prop', () => {
      const result = analyzeFixture('props-extraction.tsx');

      const propFields = result.componentObservations.filter(o => o.kind === 'PROP_FIELD');
      expect(propFields.length).toBeGreaterThan(0);

      // Check InlineComponent props
      const inlineProps = propFields.filter(o => o.evidence.componentName === 'InlineComponent');
      const propNames = inlineProps.map(o => o.evidence.propName);
      expect(propNames).toContain('label');
      expect(propNames).toContain('count');
    });

    it('captures isCallback correctly for callback props', () => {
      const result = analyzeFixture('props-extraction.tsx');

      const propFields = result.componentObservations.filter(o => o.kind === 'PROP_FIELD');

      // onSave should be marked as callback
      const onSave = propFields.find(o => o.evidence.propName === 'onSave');
      expect(onSave).toBeDefined();
      expect(onSave!.evidence.isCallback).toBe(true);

      // id should not be callback
      const id = propFields.find(o => o.evidence.propName === 'id');
      expect(id).toBeDefined();
      expect(id!.evidence.isCallback).toBe(false);
    });

    it('captures isOptional and hasDefault', () => {
      const result = analyzeFixture('props-extraction.tsx');

      const propFields = result.componentObservations.filter(o => o.kind === 'PROP_FIELD');

      // count in InlineComponent is optional with default
      const count = propFields.find(
        o => o.evidence.componentName === 'InlineComponent' && o.evidence.propName === 'count',
      );
      expect(count).toBeDefined();
      expect(count!.evidence.isOptional).toBe(true);
      expect(count!.evidence.hasDefault).toBe(true);

      // label in InlineComponent is required
      const label = propFields.find(
        o => o.evidence.componentName === 'InlineComponent' && o.evidence.propName === 'label',
      );
      expect(label).toBeDefined();
      expect(label!.evidence.isOptional).toBe(false);
    });

    it('emits no PROP_FIELD for component with no props', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      const noPropCompDecl = result.componentObservations.find(
        o => o.kind === 'COMPONENT_DECLARATION' && o.evidence.componentName === 'NoPropComponent',
      );
      expect(noPropCompDecl).toBeDefined();

      const noPropProps = result.componentObservations.filter(
        o => o.kind === 'PROP_FIELD' && o.evidence.componentName === 'NoPropComponent',
      );
      expect(noPropProps).toHaveLength(0);
    });
  });

  describe('hook observations - negative cases', () => {
    it('detects local useQuery as non-React-builtin', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      // The local useQuery function should still be detected as a hook call
      const localUseQuery = result.hookObservations.find(
        o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useQuery',
      );
      expect(localUseQuery).toBeDefined();
      // importSource should be undefined (local function, not imported)
      expect(localUseQuery!.evidence.importSource).toBeUndefined();
      expect(localUseQuery!.evidence.isReactBuiltin).toBe(false);
    });

    it('detects useId as React builtin', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      const useIdObs = result.hookObservations.find(o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useId');
      expect(useIdObs).toBeDefined();
      expect(useIdObs!.evidence.isReactBuiltin).toBe(true);
    });

    it('does not detect useful() as a hook', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      // useful is not a hook (use + lowercase)
      const usefulObs = result.hookObservations.find(o => o.kind === 'HOOK_CALL' && o.evidence.hookName === 'useful');
      expect(usefulObs).toBeUndefined();
    });

    it('detects hook with no destructuring', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      const noDestructHook = result.hookObservations.find(
        o =>
          o.kind === 'HOOK_CALL' &&
          o.evidence.hookName === 'useState' &&
          o.evidence.parentFunction === 'NoDestructuringHook',
      );
      expect(noDestructHook).toBeDefined();
      expect(noDestructHook!.evidence.destructuredNames).toEqual([]);
    });

    it('detects multiple useState calls in same component', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      const multipleHookObs = result.hookObservations.filter(
        o =>
          o.kind === 'HOOK_CALL' &&
          o.evidence.hookName === 'useState' &&
          o.evidence.parentFunction === 'MultipleHooksComponent',
      );
      expect(multipleHookObs).toHaveLength(2);
    });

    it('captures callback prop correctly from type annotation', () => {
      const result = analyzeFixture('hook-classification-negative.tsx');

      const callbackProps = result.componentObservations.filter(
        o => o.kind === 'PROP_FIELD' && o.evidence.componentName === 'CallbackPropsComponent',
      );

      // onClick should be callback (on[A-Z] pattern)
      const onClick = callbackProps.find(o => o.evidence.propName === 'onClick');
      expect(onClick).toBeDefined();
      expect(onClick!.evidence.isCallback).toBe(true);

      // transformer should be callback (=> in type)
      const transformer = callbackProps.find(o => o.evidence.propName === 'transformer');
      expect(transformer).toBeDefined();
      expect(transformer!.evidence.isCallback).toBe(true);

      // data should NOT be callback
      const data = callbackProps.find(o => o.evidence.propName === 'data');
      expect(data).toBeDefined();
      expect(data!.evidence.isCallback).toBe(false);

      // processItems should be callback (=> in type)
      const processItems = callbackProps.find(o => o.evidence.propName === 'processItems');
      expect(processItems).toBeDefined();
      expect(processItems!.evidence.isCallback).toBe(true);
    });
  });

  describe('findReturnStatementLines edge cases', () => {
    it('reports non-zero returnStatementLine for arrow component with expression body', () => {
      // Badge in arrow-expression-body.tsx is `const Badge = ({ label }) => <span>{label}</span>`
      // The funcNode is an ArrowFunction with expression body (no block), so
      // getBody() from shared.ts returns null. findReturnStatementLines then
      // falls through to the Node.isArrowFunction branch (lines 1204-1213) and
      // returns the expression body's line range.
      const result = analyzeFixture('arrow-expression-body.tsx');
      const badge = result.components.find(c => c.name === 'Badge');
      expect(badge).toBeDefined();
      expect(badge!.returnStatementLine).toBeGreaterThan(0);
      expect(badge!.returnStatementEndLine).toBeGreaterThanOrEqual(badge!.returnStatementLine);
    });

    it('reports returnStatementLine of 0 for component with no top-level return statement', () => {
      // NoReturn in arrow-expression-body.tsx has a block body that contains JSX
      // inside a variable initializer but no top-level return statement. The loop
      // in findReturnStatementLines finds no ReturnStatement and falls through to
      // the final { start: 0, end: 0 } return (line 1228).
      const result = analyzeFixture('arrow-expression-body.tsx');
      const noReturn = result.components.find(c => c.name === 'NoReturn');
      expect(noReturn).toBeDefined();
      expect(noReturn!.returnStatementLine).toBe(0);
      expect(noReturn!.returnStatementEndLine).toBe(0);
    });
  });
});
