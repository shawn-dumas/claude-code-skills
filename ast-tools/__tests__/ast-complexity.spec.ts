import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeComplexity } from '../ast-complexity';
import type { ComplexityAnalysis, FunctionComplexity } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ComplexityAnalysis {
  return analyzeComplexity(fixturePath(name));
}

function findFunction(analysis: ComplexityAnalysis, name: string): FunctionComplexity {
  const fn = analysis.functions.find(f => f.name === name);
  if (!fn) throw new Error(`Function "${name}" not found in analysis`);
  return fn;
}

describe('ast-complexity', () => {
  const result = analyzeFixture('complexity-samples.ts');

  it('simple function has complexity 1 and nesting depth 0', () => {
    // First "add" is the standalone function at line 5
    const fn = result.functions.find(f => f.name === 'add' && f.line === 5);
    expect(fn).toBeDefined();
    expect(fn!.cyclomaticComplexity).toBe(1);
    expect(fn!.maxNestingDepth).toBe(0);
    expect(fn!.contributors).toHaveLength(0);
  });

  it('if/else adds 1 to complexity', () => {
    const fn = findFunction(result, 'checkPositive');
    // base 1 + 1 if = 2
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors).toHaveLength(1);
    expect(fn.contributors[0].type).toBe('if');
  });

  it('switch with 3 cases + default reports complexity 4', () => {
    const fn = findFunction(result, 'dayType');
    // base 1 + 3 case clauses = 4 (default does NOT count)
    expect(fn.cyclomaticComplexity).toBe(4);
    expect(fn.contributors).toHaveLength(3);
    expect(fn.contributors.every(c => c.type === 'switch-case')).toBe(true);
  });

  it('nested control flow reports correct nesting depth', () => {
    const fn = findFunction(result, 'processItems');
    // if > for > if = depth 3
    expect(fn.maxNestingDepth).toBe(3);
    // base 1 + if + for + if = 4
    expect(fn.cyclomaticComplexity).toBe(4);
  });

  it('logical operators each add 1 to complexity', () => {
    const fn = findFunction(result, 'checkConditions');
    // base 1 + if + && + || = 4
    expect(fn.cyclomaticComplexity).toBe(4);
    const types = fn.contributors.map(c => c.type).sort();
    expect(types).toContain('if');
    expect(types).toContain('logical-and');
    expect(types).toContain('logical-or');
  });

  it('ternary adds 1 to complexity', () => {
    const fn = findFunction(result, 'ternaryExample');
    // base 1 + 1 ternary = 2
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors).toHaveLength(1);
    expect(fn.contributors[0].type).toBe('ternary');
  });

  it('try/catch adds 1 for catch', () => {
    const fn = findFunction(result, 'safeParse');
    // base 1 + 1 catch = 2
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors).toHaveLength(1);
    expect(fn.contributors[0].type).toBe('catch');
  });

  it('inline callback if/else contributes to enclosing function complexity', () => {
    const fn = findFunction(result, 'processWithCallback');
    // The if inside the forEach callback should contribute to processWithCallback
    // base 1 + 1 if = 2
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors).toHaveLength(1);
    expect(fn.contributors[0].type).toBe('if');
    // The arrow function inside forEach should NOT appear as a separate function entry
    const callbackEntries = result.functions.filter(
      f => f.line > fn.line && f.line < fn.endLine && f.name === '<anonymous>',
    );
    expect(callbackEntries).toHaveLength(0);
  });

  it('lineCount matches actual function span', () => {
    // add: lines 5-7 = 3 lines
    const addFn = result.functions.find(f => f.name === 'add' && f.line === 5);
    expect(addFn).toBeDefined();
    expect(addFn!.lineCount).toBe(3);

    // processItems: lines 33-43 = 11 lines
    const processFn = findFunction(result, 'processItems');
    expect(processFn.lineCount).toBe(11);
  });

  it('contributors list has correct types and line numbers', () => {
    const fn = findFunction(result, 'processItems');
    // if at line 35, for at line 36, if at line 37
    expect(fn.contributors).toHaveLength(3);

    expect(fn.contributors[0]).toEqual({ type: 'if', line: 35 });
    expect(fn.contributors[1]).toEqual({ type: 'loop', line: 36 });
    expect(fn.contributors[2]).toEqual({ type: 'if', line: 37 });
  });

  it('fileTotalComplexity sums all functions', () => {
    const expected = result.functions.reduce((sum, f) => sum + f.cyclomaticComplexity, 0);
    expect(result.fileTotalComplexity).toBe(expected);
    // Verify it is a specific positive number
    expect(result.fileTotalComplexity).toBeGreaterThan(0);
  });

  it('real file smoke test: analyzes a known source file', () => {
    const realResult = analyzeComplexity('src/shared/utils/typedStorage.ts');
    expect(realResult.filePath).toBe('src/shared/utils/typedStorage.ts');
    expect(realResult.functions.length).toBeGreaterThan(0);
    expect(realResult.fileTotalComplexity).toBeGreaterThan(0);
    // Every function should have valid structure
    for (const fn of realResult.functions) {
      expect(fn.name).toBeTruthy();
      expect(fn.line).toBeGreaterThan(0);
      expect(fn.endLine).toBeGreaterThanOrEqual(fn.line);
      expect(fn.lineCount).toBeGreaterThan(0);
      expect(fn.cyclomaticComplexity).toBeGreaterThanOrEqual(1);
      expect(fn.maxNestingDepth).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not count optional chaining as complexity', () => {
    const fn = findFunction(result, 'withNullish');
    // base 1 + 1 ?? = 2 (optional chains should NOT add complexity)
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors).toHaveLength(1);
    expect(fn.contributors[0].type).toBe('nullish-coalesce');
    // No optional-chain contributor should appear
    const optionalChainContributors = fn.contributors.filter(c => c.type === 'optional-chain');
    expect(optionalChainContributors).toHaveLength(0);
  });

  it('for-in loop adds to complexity', () => {
    const fn = findFunction(result, 'countKeys');
    // base 1 + 1 for-in = 2
    expect(fn.cyclomaticComplexity).toBe(2);
    expect(fn.contributors[0].type).toBe('loop');
  });

  it('class methods get their own complexity entries', () => {
    // Calculator.add at line 123
    const classAdd = result.functions.find(f => f.name === 'add' && f.line === 123);
    expect(classAdd).toBeDefined();
    expect(classAdd!.cyclomaticComplexity).toBe(1);

    // Calculator.conditionalAdd at line 127
    const condAdd = findFunction(result, 'conditionalAdd');
    expect(condAdd.cyclomaticComplexity).toBe(2);
  });
});
