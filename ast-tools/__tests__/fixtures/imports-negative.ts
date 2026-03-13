/* eslint-disable */
// Fixture file for ast-imports negative tests.
// Tests observation edge cases and correct detection.

// 1. Re-export that looks dead but is consumed dynamically
// This IS flagged as DEAD_EXPORT_CANDIDATE (0 static consumers).
// The observation is correct -- skills decide whether to investigate
// dynamic consumption patterns.
export const DYNAMIC_TARGET = 'value';

// 2. Type-only import (should be marked isTypeOnly: true)
import type { ImportInfo, ExportInfo } from '../../types';

// 3. A function that uses the type imports (so they are not flagged)
export function processImports(imports: ImportInfo[]): ExportInfo[] {
  return imports.map(i => ({
    name: i.source,
    kind: 'const' as const,
    isTypeOnly: i.isTypeOnly,
    line: i.line,
  }));
}

// 4. Mixed import (some type-only, some value)
// This should NOT be marked as isTypeOnly since we have value imports too
import { type ComplexityAnalysis, type FunctionComplexity } from '../../types';
import { analyzeComplexity } from '../../ast-complexity';

export function useComplexity(path: string): ComplexityAnalysis {
  const result = analyzeComplexity(path);
  return result;
}

// Use FunctionComplexity to ensure it's not dead
export function getFunctionNames(analysis: ComplexityAnalysis): string[] {
  return analysis.functions.map((f: FunctionComplexity) => f.name);
}
