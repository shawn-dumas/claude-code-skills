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

    it('classifies built-in hooks as state-utility', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      for (const hook of result.components[0].hookCalls) {
        expect(hook.classification).toBe('state-utility');
      }
    });

    it('extracts destructured names from useState', () => {
      const result = analyzeFixture('component-with-effects.tsx');
      const useStateHook = result.components[0].hookCalls.find(h => h.name === 'useState');
      expect(useStateHook).toBeDefined();
      expect(useStateHook!.destructuredNames).toEqual(['count', 'setCount']);
    });
  });

  describe('hook classification', () => {
    it('classifies locally-defined context hooks via useContext detection', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      expect(comp).toBeDefined();

      const authHook = comp!.hookCalls.find(h => h.name === 'useAuthState');
      expect(authHook).toBeDefined();
      // useAuthState is in KNOWN_CONTEXT_HOOKS, should be classified as context
      expect(authHook!.classification).toBe('context');
    });

    it('classifies useState as state-utility', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      const useStateHook = comp!.hookCalls.find(h => h.name === 'useState');
      expect(useStateHook).toBeDefined();
      expect(useStateHook!.classification).toBe('state-utility');
    });

    it('classifies useMemo and useCallback as state-utility', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      const memoHook = comp!.hookCalls.find(h => h.name === 'useMemo');
      expect(memoHook).toBeDefined();
      expect(memoHook!.classification).toBe('state-utility');

      const callbackHook = comp!.hookCalls.find(h => h.name === 'useCallback');
      expect(callbackHook).toBeDefined();
      expect(callbackHook!.classification).toBe('state-utility');
    });

    it('classifies may-remain hooks by name', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      const breakpoints = comp!.hookCalls.find(h => h.name === 'useBreakpoints');
      expect(breakpoints).toBeDefined();
      expect(breakpoints!.classification).toBe('may-remain');
    });

    it('classifies scoped hooks matching use*Scope pattern', () => {
      const result = analyzeFixture('hook-classification.tsx');
      const comp = result.components.find(c => c.name === 'ClassifiedComponent');
      const scoped = comp!.hookCalls.find(h => h.name === 'useFilterScope');
      expect(scoped).toBeDefined();
      expect(scoped!.classification).toBe('may-remain');
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
        expect(hook).toHaveProperty('classification');
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

  describe('real file smoke test', () => {
    it('analyzes ProductivityContainer.tsx and produces valid output', () => {
      const result = analyzeReactFile('src/ui/page_blocks/dashboard/team/ProductivityContainer.tsx');

      expect(result.filePath).toContain('ProductivityContainer.tsx');
      expect(result.components.length).toBeGreaterThan(0);

      const container = result.components[0];
      expect(container.name).toBe('ProductivityContainer');
      expect(container.hookCalls.length).toBeGreaterThan(0);

      // Should have a service hook classified correctly
      const serviceHook = container.hookCalls.find(h => h.name === 'useTeamsHostTimeQuery');
      expect(serviceHook).toBeDefined();
      expect(serviceHook!.classification).toBe('service');

      // Should have state-utility hooks
      const memoHooks = container.hookCalls.filter(h => h.name === 'useMemo');
      expect(memoHooks.length).toBeGreaterThan(0);
      for (const h of memoHooks) {
        expect(h.classification).toBe('state-utility');
      }

      // Output should be serializable
      const json = JSON.stringify(result);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });
});
