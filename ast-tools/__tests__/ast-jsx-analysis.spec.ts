import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeJsxComplexity } from '../ast-jsx-analysis';
import type { JsxAnalysis, JsxViolationType } from '../types';

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
        const methodMatch = t.description.match(/\.(\w+)\./);
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
});
