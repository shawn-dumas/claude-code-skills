import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeVitestParity, extractVitestParityObservations } from '../ast-vitest-parity';
import { PROJECT_ROOT } from '../project';

const fixture = (name: string) => path.join(PROJECT_ROOT, 'scripts/AST/__tests__/fixtures', name);

describe('ast-vitest-parity', () => {
  describe('analyzeVitestParity - positive fixture', () => {
    it('parses describe blocks with correct nesting depth', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      // Top-level describes: MyComponent, HelperComponent
      // Nested describes: rendering, interactions (inside MyComponent)
      expect(result.describes.length).toBe(4);

      const topLevel = result.describes.filter(d => d.nestedDepth === 0);
      expect(topLevel.length).toBe(2);
      expect(topLevel.map(d => d.name)).toContain('MyComponent');
      expect(topLevel.map(d => d.name)).toContain('HelperComponent');

      const nested = result.describes.filter(d => d.nestedDepth === 1);
      expect(nested.length).toBe(2);
      expect(nested.map(d => d.name)).toContain('rendering');
      expect(nested.map(d => d.name)).toContain('interactions');
    });

    it('parses test blocks with parent describe context', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      expect(result.tests.length).toBe(4);

      const headerTest = result.tests.find(t => t.name === 'renders the header');
      expect(headerTest).toBeDefined();
      expect(headerTest!.parentDescribe).toBe('rendering');

      const clickTest = result.tests.find(t => t.name === 'handles click');
      expect(clickTest).toBeDefined();
      expect(clickTest!.parentDescribe).toBe('interactions');

      const itemsTest = result.tests.find(t => t.name === 'renders items');
      expect(itemsTest).toBeDefined();
      expect(itemsTest!.parentDescribe).toBe('HelperComponent');
    });

    it('counts assertions per test', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      const headerTest = result.tests.find(t => t.name === 'renders the header');
      expect(headerTest!.assertionCount).toBe(2);

      const emptyTest = result.tests.find(t => t.name === 'renders empty state');
      expect(emptyTest!.assertionCount).toBe(1);

      const clickTest = result.tests.find(t => t.name === 'handles click');
      expect(clickTest!.assertionCount).toBe(1);

      const itemsTest = result.tests.find(t => t.name === 'renders items');
      expect(itemsTest!.assertionCount).toBe(1);
    });

    it('detects mock declarations with correct type classification', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      // vi.mock calls at module level (parentDescribe null)
      const viMocks = result.mocks.filter(m => m.mockType === 'vi.mock');
      expect(viMocks.length).toBe(2);
      expect(viMocks[0].mockTarget).toBe('next/router');
      expect(viMocks[0].parentDescribe).toBeNull();
      expect(viMocks[1].mockTarget).toBe('../hooks/useData');
      expect(viMocks[1].parentDescribe).toBeNull();

      // vi.fn() calls inside tests
      const viFns = result.mocks.filter(m => m.mockType === 'vi.fn');
      expect(viFns.length).toBeGreaterThanOrEqual(1);
    });

    it('detects render calls', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      expect(result.renders.length).toBe(4);

      const headerRender = result.renders.find(r => r.parentTest === 'renders the header');
      expect(headerRender).toBeDefined();
      expect(headerRender!.component).toBe('MyComponent');
      expect(headerRender!.hasWrapper).toBe(false);

      const emptyRender = result.renders.find(r => r.parentTest === 'renders empty state');
      expect(emptyRender).toBeDefined();
      expect(emptyRender!.hasWrapper).toBe(true);
    });

    it('detects fixture imports', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      expect(result.fixtureImports.length).toBe(1);
      expect(result.fixtureImports[0].source).toBe('@/fixtures');
      expect(result.fixtureImports[0].builders).toContain('build');
      expect(result.fixtureImports[0].builders).toContain('buildMany');
    });

    it('detects lifecycle hooks with cleanup patterns', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      const beforeEachHooks = result.lifecycleHooks.filter(h => h.hookType === 'beforeEach');
      expect(beforeEachHooks.length).toBe(1);
      expect(beforeEachHooks[0].scope).toBe('MyComponent');
      expect(beforeEachHooks[0].cleanupTargets).toContain('vi.clearAllMocks');

      const afterEachHooks = result.lifecycleHooks.filter(h => h.hookType === 'afterEach');
      expect(afterEachHooks.length).toBe(1);
      expect(afterEachHooks[0].scope).toBe('MyComponent');
      expect(afterEachHooks[0].cleanupTargets).toContain('vi.restoreAllMocks');
      expect(afterEachHooks[0].cleanupTargets).toContain('localStorage.clear');
    });

    it('counts tests per describe block', () => {
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));

      const rendering = result.describes.find(d => d.name === 'rendering');
      expect(rendering!.testCount).toBe(2);

      const interactions = result.describes.find(d => d.name === 'interactions');
      expect(interactions!.testCount).toBe(1);

      const helper = result.describes.find(d => d.name === 'HelperComponent');
      expect(helper!.testCount).toBe(1);
    });
  });

  describe('analyzeVitestParity - negative fixture', () => {
    it('handles empty/minimal spec files', () => {
      const result = analyzeVitestParity(fixture('vt-spec-negative.spec.ts'));

      expect(result.describes.length).toBe(0);
      expect(result.tests.length).toBe(2);
      expect(result.mocks.length).toBe(0);
      expect(result.renders.length).toBe(0);
      expect(result.fixtureImports.length).toBe(0);
      expect(result.lifecycleHooks.length).toBe(0);
    });

    it('resolves tests without parent describe as null', () => {
      const result = analyzeVitestParity(fixture('vt-spec-negative.spec.ts'));

      for (const test of result.tests) {
        expect(test.parentDescribe).toBeNull();
      }
    });

    it('counts assertions in minimal tests', () => {
      const result = analyzeVitestParity(fixture('vt-spec-negative.spec.ts'));

      expect(result.tests[0].assertionCount).toBe(1);
      expect(result.tests[1].assertionCount).toBe(1);
    });
  });

  describe('analyzeVitestParity - .each() patterns', () => {
    it('extracts test blocks from it.each patterns', () => {
      const result = analyzeVitestParity(fixture('vt-spec-each.spec.ts'));

      // 2 from it.each + 1 regular + 1 inside describe.each = 4
      expect(result.tests.length).toBe(4);

      const eachTest1 = result.tests.find(t => t.name === 'parses valid JSON: %s');
      expect(eachTest1).toBeDefined();
      expect(eachTest1!.parentDescribe).toBe('valid JSON strings');
      expect(eachTest1!.assertionCount).toBe(1);

      const eachTest2 = result.tests.find(t => t.name === 'returns null for invalid JSON: %s');
      expect(eachTest2).toBeDefined();
      expect(eachTest2!.parentDescribe).toBe('invalid JSON strings');
      expect(eachTest2!.assertionCount).toBe(1);

      const normalTest = result.tests.find(t => t.name === 'handles a normal test case');
      expect(normalTest).toBeDefined();
      expect(normalTest!.parentDescribe).toBe('parseJson');
    });

    it('extracts assertions from it.each test callbacks', () => {
      const result = analyzeVitestParity(fixture('vt-spec-each.spec.ts'));
      const obs = extractVitestParityObservations(result);

      const assertions = obs.observations.filter(o => o.kind === 'VT_ASSERTION');
      // 1 from each it.each test + 1 from regular + 1 from describe.each test = 4
      expect(assertions.length).toBe(4);

      const eachAssertion = assertions.find(a => a.evidence.parentTest === 'parses valid JSON: %s');
      expect(eachAssertion).toBeDefined();
      expect(eachAssertion!.evidence.matcher).toBe('toEqual');
    });

    it('extracts describe.each blocks', () => {
      const result = analyzeVitestParity(fixture('vt-spec-each.spec.ts'));

      // parseJson + valid JSON strings + invalid JSON strings + type: %s = 4
      const eachDescribe = result.describes.find(d => d.name === 'type: %s');
      expect(eachDescribe).toBeDefined();
      expect(eachDescribe!.nestedDepth).toBe(0);
      expect(eachDescribe!.testCount).toBe(1);
    });

    it('resolves parentDescribe for tests inside describe.each', () => {
      const result = analyzeVitestParity(fixture('vt-spec-each.spec.ts'));

      const describeEachTest = result.tests.find(t => t.name === 'round-trips through serialize');
      expect(describeEachTest).toBeDefined();
      expect(describeEachTest!.parentDescribe).toBe('type: %s');
    });
  });

  describe('Playwright spec skipping', () => {
    it('does not skip Vitest specs', () => {
      // analyzeVitestParity should parse Vitest files without issue
      const result = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));
      expect(result.tests.length).toBeGreaterThan(0);
    });

    // Note: analyzeVitestParity() reads any file directly.
    // Playwright spec skipping is enforced by analyzeVitestParityDirectory().
    // We test that the isPlaywrightSpec detection works via a Playwright fixture.
    it('Playwright spec has test blocks but would be skipped in directory mode', () => {
      // Direct analysis still works -- it just shows a spec with no mocks etc.
      const result = analyzeVitestParity(fixture('vt-spec-playwright.spec.ts'));
      expect(result.tests.length).toBe(1);
    });
  });

  describe('extractVitestParityObservations', () => {
    it('produces correct observation kinds from positive fixture', () => {
      const analysis = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));
      const result = extractVitestParityObservations(analysis);

      expect(result.filePath).toContain('vt-spec-positive.spec.tsx');
      expect(result.observations.length).toBeGreaterThan(0);

      const kinds = new Set(result.observations.map(o => o.kind));
      expect(kinds.has('VT_DESCRIBE_BLOCK')).toBe(true);
      expect(kinds.has('VT_TEST_BLOCK')).toBe(true);
      expect(kinds.has('VT_ASSERTION')).toBe(true);
      expect(kinds.has('VT_MOCK_DECLARATION')).toBe(true);
      expect(kinds.has('VT_RENDER_CALL')).toBe(true);
      expect(kinds.has('VT_FIXTURE_IMPORT')).toBe(true);
      expect(kinds.has('VT_BEFORE_EACH')).toBe(true);
      expect(kinds.has('VT_AFTER_EACH')).toBe(true);
    });

    it('produces VT_TEST_BLOCK observations with correct evidence', () => {
      const analysis = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));
      const result = extractVitestParityObservations(analysis);

      const testBlocks = result.observations.filter(o => o.kind === 'VT_TEST_BLOCK');
      expect(testBlocks.length).toBe(4);

      const header = testBlocks.find(o => o.evidence.name === 'renders the header');
      expect(header).toBeDefined();
      expect(header!.evidence.parentDescribe).toBe('rendering');
      expect(header!.evidence.assertionCount).toBe(2);
    });

    it('produces VT_ASSERTION observations with negation detection', () => {
      const analysis = analyzeVitestParity(fixture('vt-spec-positive.spec.tsx'));
      const result = extractVitestParityObservations(analysis);

      const assertions = result.observations.filter(o => o.kind === 'VT_ASSERTION');
      expect(assertions.length).toBeGreaterThan(0);

      // The "handles click" test has expect(handler).not.toHaveBeenCalled()
      const negated = assertions.find(a => a.evidence.negated === true);
      expect(negated).toBeDefined();
      expect(negated!.evidence.matcher).toBe('toHaveBeenCalled');
    });

    it('produces no observations from empty fixture', () => {
      const analysis = analyzeVitestParity(fixture('vt-spec-negative.spec.ts'));
      const result = extractVitestParityObservations(analysis);

      const kinds = new Set(result.observations.map(o => o.kind));
      // Should have test blocks and assertions, but no describe/mock/render/fixture/lifecycle
      expect(kinds.has('VT_DESCRIBE_BLOCK')).toBe(false);
      expect(kinds.has('VT_MOCK_DECLARATION')).toBe(false);
      expect(kinds.has('VT_RENDER_CALL')).toBe(false);
      expect(kinds.has('VT_FIXTURE_IMPORT')).toBe(false);
      expect(kinds.has('VT_BEFORE_EACH')).toBe(false);
      expect(kinds.has('VT_AFTER_EACH')).toBe(false);

      // But should have test blocks and assertions
      expect(kinds.has('VT_TEST_BLOCK')).toBe(true);
      expect(kinds.has('VT_ASSERTION')).toBe(true);
    });
  });
});
