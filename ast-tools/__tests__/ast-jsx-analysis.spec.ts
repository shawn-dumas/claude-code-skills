import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeJsxComplexity, analyzeJsxComplexityDirectory, extractJsxObservations } from '../ast-jsx-analysis';
import type { JsxAnalysis, JsxViolationType, JsxObservation, JsxObservationKind } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): JsxAnalysis {
  return analyzeJsxComplexity(fixturePath(name));
}

function violationTypes(analysis: JsxAnalysis, componentName?: string): JsxViolationType[] {
  const comps = componentName ? analysis.components.filter(c => c.name === componentName) : analysis.components;
  return comps.flatMap(c => c.violations.map(v => v.type));
}

describe('ast-jsx-analysis', () => {
  describe('clean component', () => {
    it('reports no violations for a simple component', () => {
      const result = analyzeFixture('simple-component.tsx');

      expect(result.components).toHaveLength(1);
      expect(result.components[0].violations).toHaveLength(0);
    });

    it('reports correct return statement line counts', () => {
      const result = analyzeFixture('simple-component.tsx');
      const comp = result.components[0];

      expect(comp.returnStartLine).toBeGreaterThan(0);
      expect(comp.returnEndLine).toBeGreaterThanOrEqual(comp.returnStartLine);
      expect(comp.returnLineCount).toBeGreaterThan(0);
    });
  });

  describe('CHAINED_TERNARY', () => {
    it('detects chained ternary with correct nesting depth', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const ternaries = comp.violations.filter(v => v.type === 'CHAINED_TERNARY');

      expect(ternaries.length).toBeGreaterThanOrEqual(1);

      const first = ternaries[0];
      expect(first.description).toContain('depth 3');
      expect(first.parentComponent).toBe('ComplexList');
    });

    it('does not flag a simple binary ternary', () => {
      const result = analyzeFixture('simple-component.tsx');
      const ternaries = result.components.flatMap(c => c.violations.filter(v => v.type === 'CHAINED_TERNARY'));
      expect(ternaries).toHaveLength(0);
    });
  });

  describe('COMPLEX_GUARD', () => {
    it('detects guard chains with 3+ conditions', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const guards = comp.violations.filter(v => v.type === 'COMPLEX_GUARD');

      expect(guards.length).toBeGreaterThanOrEqual(1);

      const first = guards[0];
      expect(first.description).toContain('3');
      expect(first.parentComponent).toBe('ComplexList');
    });

    it('does not flag 1-2 condition guards', () => {
      // The fixture has {isAdmin && <span>} and {isAdmin && isLoading && <span>}
      // Neither should be flagged
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const guards = comp.violations.filter(v => v.type === 'COMPLEX_GUARD');

      // Should only flag the 3-condition guard, not the 1 or 2 condition ones
      for (const guard of guards) {
        expect(guard.description).not.toMatch(/\b[12] conditions/);
      }
    });
  });

  describe('INLINE_TRANSFORM', () => {
    it('detects chained .filter().map() in return', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const transforms = comp.violations.filter(v => v.type === 'INLINE_TRANSFORM');

      expect(transforms.length).toBeGreaterThanOrEqual(1);
      expect(transforms[0].description).toContain('filter');
      expect(transforms[0].description).toContain('map');
    });

    it('does NOT flag a simple .map() alone', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const transforms = comp.violations.filter(v => v.type === 'INLINE_TRANSFORM');

      // Should not include any violation that is only about a single .map()
      for (const t of transforms) {
        // Each transform violation must involve 2+ methods
        const methodMatch = /\.(\w+)\./.exec(t.description);
        expect(methodMatch).not.toBeNull();
      }
    });
  });

  describe('IIFE_IN_JSX', () => {
    it('detects immediately-invoked function expressions in JSX', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const iifes = comp.violations.filter(v => v.type === 'IIFE_IN_JSX');

      expect(iifes).toHaveLength(1);
      expect(iifes[0].description).toContain('IIFE');
    });
  });

  describe('MULTI_STMT_HANDLER', () => {
    it('detects multi-statement event handlers', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const handlers = comp.violations.filter(v => v.type === 'MULTI_STMT_HANDLER');

      expect(handlers.length).toBeGreaterThanOrEqual(1);

      const first = handlers[0];
      expect(first.description).toContain('onClick');
      expect(first.description).toMatch(/\d+ statements/);
    });

    it('does not flag single-expression handlers', () => {
      // The fixture has onClick={() => onSelect('test')} which should NOT be flagged
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const handlers = comp.violations.filter(v => v.type === 'MULTI_STMT_HANDLER');

      // All flagged handlers should have 2+ statements
      for (const h of handlers) {
        expect(h.description).not.toContain('1 statements');
      }
    });
  });

  describe('INLINE_STYLE_OBJECT', () => {
    it('detects inline style objects with computed values', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const styles = comp.violations.filter(v => v.type === 'INLINE_STYLE_OBJECT');

      expect(styles.length).toBeGreaterThanOrEqual(1);
      expect(styles[0].description).toContain('computed');
    });
  });

  describe('COMPLEX_CLASSNAME', () => {
    it('detects chained ternary in className', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];
      const classNames = comp.violations.filter(v => v.type === 'COMPLEX_CLASSNAME');

      expect(classNames.length).toBeGreaterThanOrEqual(1);
      expect(classNames[0].description).toMatch(/ternari/);
      // Ternaries in className should not also appear as CHAINED_TERNARY
      const ternaryLines = comp.violations.filter(v => v.type === 'CHAINED_TERNARY').map(v => v.line);
      for (const cn of classNames) {
        expect(ternaryLines).not.toContain(cn.line);
      }
    });
  });

  describe('return line count', () => {
    it('reports correct return line count for complex component', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];

      expect(comp.returnStartLine).toBeGreaterThan(0);
      expect(comp.returnEndLine).toBeGreaterThan(comp.returnStartLine);
      expect(comp.returnLineCount).toBe(comp.returnEndLine - comp.returnStartLine + 1);
    });
  });

  describe('combined fixture', () => {
    it('detects all violation types in the complex fixture', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const types = violationTypes(result);

      expect(types).toContain('CHAINED_TERNARY');
      expect(types).toContain('INLINE_TRANSFORM');
      expect(types).toContain('IIFE_IN_JSX');
      expect(types).toContain('MULTI_STMT_HANDLER');
      expect(types).toContain('COMPLEX_GUARD');
      expect(types).toContain('INLINE_STYLE_OBJECT');
      expect(types).toContain('COMPLEX_CLASSNAME');
    });

    it('does not double-report violations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const comp = result.components[0];

      // Each violation should have a unique line (within the same type at least)
      const linesByType = new Map<string, number[]>();
      for (const v of comp.violations) {
        const existing = linesByType.get(v.type) ?? [];
        existing.push(v.line);
        linesByType.set(v.type, existing);
      }

      for (const [type, lines] of linesByType) {
        const unique = new Set(lines);
        expect(unique.size, `Duplicate lines for ${type}: ${lines.join(', ')}`).toBe(lines.length);
      }
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real project component without crashing', () => {
      const result = analyzeJsxComplexity('src/ui/page_blocks/dashboard/team/ProductivityBlock.tsx');

      expect(result.filePath).toContain('ProductivityBlock.tsx');
      expect(result.components.length).toBeGreaterThanOrEqual(1);

      for (const comp of result.components) {
        expect(comp.name).toBeTruthy();
        expect(comp.returnStartLine).toBeGreaterThan(0);
        for (const v of comp.violations) {
          expect(v.type).toBeTruthy();
          expect(v.line).toBeGreaterThan(0);
          expect(v.parentComponent).toBe(comp.name);
        }
      }
    });
  });

  describe('observations', () => {
    function observationKinds(observations: JsxObservation[]): JsxObservationKind[] {
      return observations.map(o => o.kind);
    }

    it('includes observations array in analysis output', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');

      expect(result.observations).toBeDefined();
      expect(result.observations.length).toBeGreaterThan(0);
    });

    it('emits JSX_RETURN_BLOCK observations for each component', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const returnBlocks = result.observations.filter(o => o.kind === 'JSX_RETURN_BLOCK');

      expect(returnBlocks).toHaveLength(1);
      expect(returnBlocks[0].evidence.componentName).toBe('ComplexList');
      expect(returnBlocks[0].evidence.returnStartLine).toBeGreaterThan(0);
      expect(returnBlocks[0].evidence.returnEndLine).toBeGreaterThan(0);
      expect(returnBlocks[0].evidence.returnLineCount).toBeGreaterThan(0);
    });

    it('emits observations for all JSX pattern kinds in complex fixture', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const kinds = observationKinds(result.observations);

      expect(kinds).toContain('JSX_RETURN_BLOCK');
      expect(kinds).toContain('JSX_TERNARY_CHAIN');
      expect(kinds).toContain('JSX_GUARD_CHAIN');
      expect(kinds).toContain('JSX_TRANSFORM_CHAIN');
      expect(kinds).toContain('JSX_IIFE');
      expect(kinds).toContain('JSX_INLINE_HANDLER');
      expect(kinds).toContain('JSX_INLINE_STYLE');
      expect(kinds).toContain('JSX_COMPLEX_CLASSNAME');
    });

    it('includes correct evidence for ternary chain observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const ternaries = result.observations.filter(o => o.kind === 'JSX_TERNARY_CHAIN');

      expect(ternaries.length).toBeGreaterThanOrEqual(1);
      expect(ternaries[0].evidence.depth).toBe(3);
      expect(ternaries[0].evidence.componentName).toBe('ComplexList');
    });

    it('includes correct evidence for transform chain observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const transforms = result.observations.filter(o => o.kind === 'JSX_TRANSFORM_CHAIN');

      expect(transforms.length).toBeGreaterThanOrEqual(1);
      expect(transforms[0].evidence.methods).toContain('filter');
      expect(transforms[0].evidence.methods).toContain('map');
      expect(transforms[0].evidence.chainLength).toBe(2);
    });

    it('includes correct evidence for guard chain observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const guards = result.observations.filter(o => o.kind === 'JSX_GUARD_CHAIN');

      // Should have observations for 1-cond, 2-cond, and 3-cond guards
      expect(guards.length).toBeGreaterThanOrEqual(3);
      const condCounts = guards.map(g => g.evidence.conditionCount);
      expect(condCounts).toContain(1);
      expect(condCounts).toContain(2);
      expect(condCounts).toContain(3);
    });

    it('includes correct evidence for inline handler observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const handlers = result.observations.filter(o => o.kind === 'JSX_INLINE_HANDLER');

      expect(handlers.length).toBeGreaterThanOrEqual(2);
      // Find multi-statement handler
      const multi = handlers.find(h => (h.evidence.statementCount ?? 0) >= 2);
      expect(multi).toBeDefined();
      expect(multi!.evidence.handlerName).toBe('onClick');
      // Find single-statement handler
      const single = handlers.find(h => h.evidence.statementCount === 1);
      expect(single).toBeDefined();
    });

    it('includes correct evidence for inline style observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const styles = result.observations.filter(o => o.kind === 'JSX_INLINE_STYLE');

      expect(styles.length).toBeGreaterThanOrEqual(1);
      expect(styles[0].evidence.hasComputedValues).toBe(true);
    });

    it('includes correct evidence for complex className observations', () => {
      const result = analyzeFixture('component-with-jsx-complexity.tsx');
      const classNames = result.observations.filter(o => o.kind === 'JSX_COMPLEX_CLASSNAME');

      expect(classNames.length).toBeGreaterThanOrEqual(1);
      expect(classNames[0].evidence.ternaryCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('negative fixtures (sub-threshold patterns)', () => {
    it('emits observations for sub-threshold patterns but not violations', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const allViolations = result.components.flatMap(c => c.violations);

      // Should have zero violations (all patterns are below threshold)
      expect(allViolations).toHaveLength(0);

      // But should have observations
      expect(result.observations.length).toBeGreaterThan(0);
    });

    it('emits JSX_TERNARY_CHAIN with depth 1 but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_TERNARY_CHAIN' && o.evidence.componentName === 'SimpleTernary',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.depth).toBe(1);

      // No CHAINED_TERNARY violation
      const violations = result.components
        .find(c => c.name === 'SimpleTernary')
        ?.violations.filter(v => v.type === 'CHAINED_TERNARY');
      expect(violations).toHaveLength(0);
    });

    it('emits JSX_COMPLEX_CLASSNAME with ternaryCount 1 but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_COMPLEX_CLASSNAME' && o.evidence.componentName === 'SimpleClassName',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.ternaryCount).toBe(1);

      // No COMPLEX_CLASSNAME violation
      const violations = result.components
        .find(c => c.name === 'SimpleClassName')
        ?.violations.filter(v => v.type === 'COMPLEX_CLASSNAME');
      expect(violations).toHaveLength(0);
    });

    it('emits JSX_INLINE_HANDLER with statementCount 1 but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_INLINE_HANDLER' && o.evidence.componentName === 'OneLineHandler',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.statementCount).toBe(1);

      // No MULTI_STMT_HANDLER violation
      const violations = result.components
        .find(c => c.name === 'OneLineHandler')
        ?.violations.filter(v => v.type === 'MULTI_STMT_HANDLER');
      expect(violations).toHaveLength(0);
    });

    it('emits JSX_TRANSFORM_CHAIN with chainLength 1 but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_TRANSFORM_CHAIN' && o.evidence.componentName === 'SingleMap',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.chainLength).toBe(1);

      // No INLINE_TRANSFORM violation
      const violations = result.components
        .find(c => c.name === 'SingleMap')
        ?.violations.filter(v => v.type === 'INLINE_TRANSFORM');
      expect(violations).toHaveLength(0);
    });

    it('emits JSX_INLINE_STYLE with hasComputedValues false but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_INLINE_STYLE' && o.evidence.componentName === 'StaticStyle',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.hasComputedValues).toBe(false);

      // No INLINE_STYLE_OBJECT violation
      const violations = result.components
        .find(c => c.name === 'StaticStyle')
        ?.violations.filter(v => v.type === 'INLINE_STYLE_OBJECT');
      expect(violations).toHaveLength(0);
    });

    it('does NOT emit ternary observation for non-JSX context', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_TERNARY_CHAIN' && o.evidence.componentName === 'NonJsxTernary',
      );

      // The ternary is in a const declaration, not inside the return
      expect(obs).toHaveLength(0);
    });

    it('emits JSX_GUARD_CHAIN with conditionCount 2 but no violation', () => {
      const result = analyzeFixture('jsx-negative.tsx');
      const obs = result.observations.filter(
        o => o.kind === 'JSX_GUARD_CHAIN' && o.evidence.componentName === 'TwoConditionGuard',
      );

      expect(obs).toHaveLength(1);
      expect(obs[0].evidence.conditionCount).toBe(2);

      // No COMPLEX_GUARD violation
      const violations = result.components
        .find(c => c.name === 'TwoConditionGuard')
        ?.violations.filter(v => v.type === 'COMPLEX_GUARD');
      expect(violations).toHaveLength(0);
    });
  });

  describe('extractJsxObservations', () => {
    it('returns observations without including them in analysis output', () => {
      const observations = extractJsxObservations(fixturePath('component-with-jsx-complexity.tsx'));

      expect(observations.length).toBeGreaterThan(0);
      expect(observations.some(o => o.kind === 'JSX_RETURN_BLOCK')).toBe(true);
      expect(observations.some(o => o.kind === 'JSX_TERNARY_CHAIN')).toBe(true);
    });

    it('includes sub-threshold patterns in observations', () => {
      const observations = extractJsxObservations(fixturePath('jsx-negative.tsx'));

      // Should have observations for all the below-threshold patterns
      expect(observations.some(o => o.kind === 'JSX_TERNARY_CHAIN' && o.evidence.depth === 1)).toBe(true);
      expect(observations.some(o => o.kind === 'JSX_TRANSFORM_CHAIN' && o.evidence.chainLength === 1)).toBe(true);
      expect(observations.some(o => o.kind === 'JSX_GUARD_CHAIN' && o.evidence.conditionCount === 2)).toBe(true);
    });
  });

  describe('analyzeJsxComplexityDirectory', () => {
    it('analyzes all matching files in a directory without crashing', () => {
      const results = analyzeJsxComplexityDirectory(FIXTURES_DIR);
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.filePath).toBeDefined();
        expect(r.components).toBeDefined();
        expect(r.observations).toBeDefined();
      }
    });

    it('skips files with no components or observations', () => {
      const results = analyzeJsxComplexityDirectory(FIXTURES_DIR);
      for (const r of results) {
        // Every included result must have at least one component or observation
        expect(r.components.length + r.observations.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('isInsideJsxAttribute top-level guard path (line 115)', () => {
  // A component returning a top-level && expression (not nested inside a JSX element)
  // causes isInsideJsxAttribute to walk all the way up without finding a JsxAttribute
  // or any JSX container, returning false at line 115.
  it('processes a component with a top-level && guard without crashing', () => {
    const result = analyzeJsxComplexity(fixturePath('jsx-toplevel-guard.tsx'));

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('TopLevelGuard');
  });

  it('emits JSX_GUARD_CHAIN observation for top-level && guard', () => {
    const result = analyzeJsxComplexity(fixturePath('jsx-toplevel-guard.tsx'));
    const guards = result.observations.filter(o => o.kind === 'JSX_GUARD_CHAIN');

    // The && guard at the return level should be detected
    expect(guards).toHaveLength(1);
    expect(guards[0].evidence.conditionCount).toBe(1);
    expect(guards[0].evidence.componentName).toBe('TopLevelGuard');
  });
});
