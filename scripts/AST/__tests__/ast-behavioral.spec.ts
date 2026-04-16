import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeBehavioral, extractBehavioralObservations, analyzeBehavioralDirectory } from '../ast-behavioral';
import { getSourceFile } from '../project';
import type { BehavioralAnalysis, BehavioralObservation, BehavioralObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): BehavioralAnalysis {
  return analyzeBehavioral(fixturePath(name));
}

function observationsOfKind(analysis: BehavioralAnalysis, kind: BehavioralObservationKind): BehavioralObservation[] {
  return analysis.observations.filter(o => o.kind === kind);
}

describe('ast-behavioral', () => {
  describe('positive detection (behavioral-samples.tsx)', () => {
    it('produces observations for all 8 kinds', () => {
      const result = analyzeFixture('behavioral-samples.tsx');
      const kinds = new Set(result.observations.map(o => o.kind));

      expect(kinds.has('DEFAULT_PROP_VALUE')).toBe(true);
      expect(kinds.has('RENDER_CAP')).toBe(true);
      expect(kinds.has('NULL_COERCION_DISPLAY')).toBe(true);
      expect(kinds.has('CONDITIONAL_RENDER_GUARD')).toBe(true);
      expect(kinds.has('JSX_STRING_LITERAL')).toBe(true);
      expect(kinds.has('COLUMN_DEFINITION')).toBe(true);
      expect(kinds.has('STATE_INITIALIZATION')).toBe(true);
      expect(kinds.has('TYPE_COERCION_BOUNDARY')).toBe(true);
    });

    it('each kind has at least 1 observation', () => {
      const result = analyzeFixture('behavioral-samples.tsx');
      const allKinds: BehavioralObservationKind[] = [
        'DEFAULT_PROP_VALUE',
        'RENDER_CAP',
        'NULL_COERCION_DISPLAY',
        'CONDITIONAL_RENDER_GUARD',
        'JSX_STRING_LITERAL',
        'COLUMN_DEFINITION',
        'STATE_INITIALIZATION',
        'TYPE_COERCION_BOUNDARY',
      ];

      for (const kind of allKinds) {
        const obs = observationsOfKind(result, kind);
        expect(obs.length, `Expected at least 1 ${kind} observation`).toBeGreaterThanOrEqual(1);
      }
    });

    describe('DEFAULT_PROP_VALUE', () => {
      it('detects destructured prop defaults', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'DEFAULT_PROP_VALUE');
        const names = obs.map(o => o.evidence.name);

        expect(names).toContain('visible');
        expect(names).toContain('label');
      });

      it('has correct evidence fields', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'DEFAULT_PROP_VALUE');
        const visibleObs = obs.find(o => o.evidence.name === 'visible');

        expect(visibleObs).toBeDefined();
        expect(visibleObs!.evidence.category).toBe('default-values');
        expect(visibleObs!.evidence.value).toBe('true');
        expect(visibleObs!.evidence.containingFunction).toBe('MyComponent');
      });
    });

    describe('STATE_INITIALIZATION', () => {
      it('detects useState with default values', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'STATE_INITIALIZATION');

        expect(obs.length).toBeGreaterThanOrEqual(3);
        const names = obs.map(o => o.evidence.name);
        expect(names).toContain('count');
        expect(names).toContain('name');
        expect(names).toContain('items');
      });

      it('has correct evidence for useState(0)', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'STATE_INITIALIZATION');
        const countObs = obs.find(o => o.evidence.name === 'count');

        expect(countObs).toBeDefined();
        expect(countObs!.evidence.category).toBe('state-preservation');
        expect(countObs!.evidence.value).toBe('0');
        expect(countObs!.evidence.context).toBe('useState');
      });
    });

    describe('COLUMN_DEFINITION', () => {
      it('detects column definitions', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'COLUMN_DEFINITION');

        expect(obs.length).toBeGreaterThanOrEqual(3);
      });

      it('extracts column ID and header text', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'COLUMN_DEFINITION');
        const nameCol = obs.find(o => o.evidence.name === 'name');

        expect(nameCol).toBeDefined();
        expect(nameCol!.evidence.category).toBe('column-field-parity');
        expect(nameCol!.evidence.value).toBe('Full Name');
      });
    });

    describe('TYPE_COERCION_BOUNDARY', () => {
      it('detects Number() and .toString()', () => {
        const result = analyzeFixture('behavioral-samples.tsx');
        const obs = observationsOfKind(result, 'TYPE_COERCION_BOUNDARY');
        const names = obs.map(o => o.evidence.name);

        expect(names).toContain('Number');
        expect(names).toContain('toString');
      });
    });
  });

  describe('negative detection (behavioral-negative.tsx)', () => {
    it('produces 0 or near-0 observations', () => {
      const result = analyzeFixture('behavioral-negative.tsx');
      expect(result.observations.length).toBe(0);
    });
  });

  describe('summary counts match observation counts', () => {
    it('summary matches actual observation counts per kind', () => {
      const result = analyzeFixture('behavioral-samples.tsx');

      for (const [kind, count] of Object.entries(result.summary)) {
        const actual = result.observations.filter(o => o.kind === kind).length;
        expect(actual, `Summary mismatch for ${kind}`).toBe(count);
      }
    });
  });

  describe('observation structure', () => {
    it('all observations have required fields', () => {
      const result = analyzeFixture('behavioral-samples.tsx');
      for (const obs of result.observations) {
        expect(obs.kind).toBeDefined();
        expect(obs.file).toBeDefined();
        expect(obs.line).toBeGreaterThan(0);
        expect(obs.evidence).toBeDefined();
        expect(obs.evidence.category).toBeDefined();
      }
    });

    it('observations are sorted by line number', () => {
      const result = analyzeFixture('behavioral-samples.tsx');
      for (let i = 1; i < result.observations.length; i++) {
        expect(result.observations[i].line).toBeGreaterThanOrEqual(result.observations[i - 1].line);
      }
    });
  });

  describe('directory analysis', () => {
    it('returns results for the fixtures directory', () => {
      const results = analyzeBehavioralDirectory(FIXTURES_DIR, { filter: 'all' });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('direct extraction', () => {
    it('works from a SourceFile', () => {
      const sf = getSourceFile(fixturePath('behavioral-samples.tsx'));
      const observations = extractBehavioralObservations(sf);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations[0].kind).toBeDefined();
    });
  });
});

describe('ast-behavioral parenthesized JSX and non-destructured state (behavioral-parenthesized-jsx.tsx)', () => {
  it('emits CONDITIONAL_RENDER_GUARD for && guard with parenthesized JsxSelfClosingElement', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // selfClosingGuard: show && (<input .../>) -- right is ParenthesizedExpression containing JsxSelfClosingElement
    expect(obs.length).toBeGreaterThanOrEqual(1);
  });

  it('emits CONDITIONAL_RENDER_GUARD for && guard with parenthesized JsxFragment', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // fragmentGuard: count > 0 && (<>...</>) -- right is ParenthesizedExpression containing JsxFragment
    expect(obs.length).toBeGreaterThanOrEqual(2);
  });

  it('emits CONDITIONAL_RENDER_GUARD for ternary where branch wraps JSX in parentheses', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // wrappedTernary: show ? (<span>...</span>) : null -- whenTrue is ParenthesizedExpression
    expect(obs.length).toBeGreaterThanOrEqual(1);
  });

  it('emits STATE_INITIALIZATION for plain identifier binding (non-destructured useState)', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'STATE_INITIALIZATION');
    // const stateResult = useState(42) -- nameNode is Identifier, not ArrayBindingPattern
    expect(obs.length).toBeGreaterThanOrEqual(1);
    const stateObs = obs.find(o => o.evidence.value === '42');
    expect(stateObs).toBeDefined();
    expect(stateObs!.evidence.name).toBe('stateResult');
  });
});

describe('ast-behavioral parenthesized JSX and non-destructured state (behavioral-parenthesized-jsx.tsx)', () => {
  it('emits CONDITIONAL_RENDER_GUARD for && guard with parenthesized JsxSelfClosingElement', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // selfClosingGuard: show && (<input .../>) -- right is ParenthesizedExpression containing JsxSelfClosingElement
    expect(obs.length).toBeGreaterThanOrEqual(1);
  });

  it('emits CONDITIONAL_RENDER_GUARD for && guard with parenthesized JsxFragment', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // fragmentGuard: count > 0 && (<>...</>) -- right is ParenthesizedExpression containing JsxFragment
    expect(obs.length).toBeGreaterThanOrEqual(2);
  });

  it('emits CONDITIONAL_RENDER_GUARD for ternary where branch wraps JSX in parentheses', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'CONDITIONAL_RENDER_GUARD');
    // wrappedTernary: show ? (<span>...</span>) : null -- whenTrue is ParenthesizedExpression
    expect(obs.length).toBeGreaterThanOrEqual(1);
  });

  it('emits STATE_INITIALIZATION for plain identifier binding (non-destructured useState)', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'STATE_INITIALIZATION');
    // const stateResult = useState(42) -- nameNode is Identifier, not ArrayBindingPattern
    expect(obs.length).toBeGreaterThanOrEqual(1);
    const stateObs = obs.find(o => o.evidence.value === '42');
    expect(stateObs).toBeDefined();
    expect(stateObs!.evidence.name).toBe('stateResult');
  });

  it('emits RENDER_CAP for .slice(0, N) with numeric literal N (line 90)', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'RENDER_CAP' && o.evidence.name === 'slice');
    // items.slice(0, 5) -- both args are numeric literals, second arg is 5
    expect(obs.length).toBeGreaterThanOrEqual(1);
    expect(obs[0].evidence.value).toBe('5');
  });

  it('emits JSX_STRING_LITERAL for string literal inside JsxExpression (lines 265-267)', () => {
    const result = analyzeFixture('behavioral-parenthesized-jsx.tsx');
    const obs = result.observations.filter(o => o.kind === 'JSX_STRING_LITERAL');
    // {"Static string content"} -- JsxExpression with StringLiteral inside JSX
    const jsxExprObs = obs.find(o => o.evidence.value === 'Static string content');
    expect(jsxExprObs).toBeDefined();
    expect(jsxExprObs!.evidence.category).toBe('string-literal-parity');
  });
});
