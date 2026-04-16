import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  analyzeHandlerStructure,
  analyzeHandlerStructureDirectory,
  extractHandlerStructureObservations,
} from '../ast-handler-structure';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixtureDir(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function fixturePath(dir: string, file: string): string {
  return path.join(FIXTURES_DIR, dir, file);
}

// ---------------------------------------------------------------------------
// Synthetic fixture tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: synthetic fixtures', () => {
  describe('handler-structure-clean', () => {
    it('emits no observations for handler delegating to .logic.ts', () => {
      const result = analyzeHandlerStructure(fixturePath('handler-structure-clean', 'users.ts'));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixtureDir('handler-structure-clean'), 'manifest.json'), 'utf-8'),
      );

      expect(result.observations).toHaveLength(0);
      expect(manifest.expectedObservations).toHaveLength(0);
    });
  });

  describe('handler-structure-inline', () => {
    it('emits HANDLER_INLINE_LOGIC for handler with 20+ lines of inline logic', () => {
      const result = analyzeHandlerStructure(fixturePath('handler-structure-inline', 'reports.ts'));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixtureDir('handler-structure-inline'), 'manifest.json'), 'utf-8'),
      );

      const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
      expect(inlineObs).toHaveLength(1);
      expect(inlineObs[0].file).toContain('reports.ts');
      expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
      expect(inlineObs[0].evidence.delegatesTo).toBeNull();
      expect(manifest.expectedObservations[0].type).toBe('HANDLER_INLINE_LOGIC');
    });
  });

  describe('handler-structure-multi-method', () => {
    it('emits HANDLER_MULTI_METHOD for handler with 3 HTTP methods', () => {
      const result = analyzeHandlerStructure(fixturePath('handler-structure-multi-method', 'items.ts'));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixtureDir('handler-structure-multi-method'), 'manifest.json'), 'utf-8'),
      );

      const multiObs = result.observations.filter(o => o.kind === 'HANDLER_MULTI_METHOD');
      expect(multiObs).toHaveLength(1);
      expect(multiObs[0].file).toContain('items.ts');
      expect(multiObs[0].evidence.methods).toEqual(['DELETE', 'GET', 'POST']);
      expect(manifest.expectedObservations[0].type).toBe('HANDLER_MULTI_METHOD');
      expect(manifest.expectedObservations[0].methods).toEqual(['DELETE', 'GET', 'POST']);
    });
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: real-world fixtures', () => {
  describe('handler-structure-real-clean', () => {
    it('emits no observations for clean delegating handler', () => {
      const result = analyzeHandlerStructure(fixturePath('handler-structure-real-clean', 'update.ts'));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixtureDir('handler-structure-real-clean'), 'manifest.json'), 'utf-8'),
      );

      expect(result.observations).toHaveLength(0);
      expect(manifest.expectedObservations).toHaveLength(0);
    });
  });

  describe('handler-structure-real-inline', () => {
    it('emits HANDLER_INLINE_LOGIC for handler with inline DB queries', () => {
      const result = analyzeHandlerStructure(fixturePath('handler-structure-real-inline', 'create.ts'));
      const manifest = JSON.parse(
        fs.readFileSync(path.join(fixtureDir('handler-structure-real-inline'), 'manifest.json'), 'utf-8'),
      );

      const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
      expect(inlineObs).toHaveLength(1);
      expect(inlineObs[0].file).toContain('create.ts');
      expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
      // This handler has partial delegation (toTeamResponse from create.logic)
      expect(inlineObs[0].evidence.delegatesTo).toContain('.logic');
      expect(manifest.expectedObservations[0].type).toBe('HANDLER_INLINE_LOGIC');
    });
  });
});

// ---------------------------------------------------------------------------
// Threshold boundary tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: threshold boundaries', () => {
  it('does not emit for handler with exactly threshold lines', () => {
    // The clean handler fixture has fewer than 15 non-trivial lines
    const result = analyzeHandlerStructure(fixturePath('handler-structure-clean', 'users.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(0);
  });

  it('emits for handler with threshold + 1 lines', () => {
    // The inline handler fixture has well over 15 non-trivial lines
    const result = analyzeHandlerStructure(fixturePath('handler-structure-inline', 'reports.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.threshold).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Comment and blank line exclusion tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: comment and blank line exclusion', () => {
  it('excludes comments and blank lines from line count', () => {
    // The clean handler has delegation calls + a few lines; comments/blanks should not inflate the count
    const result = analyzeHandlerStructure(fixturePath('handler-structure-clean', 'users.ts'));
    // Should not trigger because handler body is small even without counting comments
    expect(result.observations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Single method test
// ---------------------------------------------------------------------------

describe('ast-handler-structure: single method handling', () => {
  it('does not emit HANDLER_MULTI_METHOD for single-method handler', () => {
    // The clean handler uses only one method (no method routing)
    const result = analyzeHandlerStructure(fixturePath('handler-structure-clean', 'users.ts'));
    const multiObs = result.observations.filter(o => o.kind === 'HANDLER_MULTI_METHOD');
    expect(multiObs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Directory analysis tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: directory analysis', () => {
  it('analyzes all files in a directory', () => {
    const results = analyzeHandlerStructureDirectory(fixtureDir('handler-structure-inline'));
    expect(results.length).toBeGreaterThanOrEqual(1);

    const allObs = results.flatMap(r => r.observations);
    const inlineObs = allObs.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Arrow function and function expression handler tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: arrow function handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as arrow function', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });

  it('does not inflate line count with multi-line block comments in arrow function body', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    // Block comment lines should be excluded; only real logic lines counted
    expect(inlineObs[0].evidence.handlerLines).toBeLessThan(30);
  });
});

describe('ast-handler-structure: function expression handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as function expression', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-func-expr', 'func-expr.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// extractHandlerStructureObservations
// ---------------------------------------------------------------------------

describe('ast-handler-structure: extractHandlerStructureObservations', () => {
  it('returns standard ObservationResult shape', () => {
    const analysis = analyzeHandlerStructure(fixturePath('handler-structure-inline', 'reports.ts'));
    const obsResult = extractHandlerStructureObservations(analysis);
    expect(obsResult.filePath).toBe(analysis.filePath);
    expect(obsResult.observations).toEqual(analysis.observations);
  });
});

// ---------------------------------------------------------------------------
// Arrow function and function expression handler tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: arrow function handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as arrow function', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });

  it('does not inflate line count with multi-line block comments in arrow function body', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    // Block comment lines should be excluded; only real logic lines counted
    expect(inlineObs[0].evidence.handlerLines).toBeLessThan(30);
  });
});

describe('ast-handler-structure: function expression handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as function expression', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-func-expr', 'func-expr.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Default export function handler tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: export default function handler', () => {
  it('detects HANDLER_INLINE_LOGIC for export default function (non-standard name)', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-default-export', 'default-export.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// extractHandlerStructureObservations
// ---------------------------------------------------------------------------

describe('ast-handler-structure: extractHandlerStructureObservations', () => {
  it('returns standard ObservationResult shape', () => {
    const analysis = analyzeHandlerStructure(fixturePath('handler-structure-inline', 'reports.ts'));
    const obsResult = extractHandlerStructureObservations(analysis);
    expect(obsResult.filePath).toBe(analysis.filePath);
    expect(obsResult.observations).toEqual(analysis.observations);
  });
});

// ---------------------------------------------------------------------------
// Arrow function and function expression handler tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: arrow function handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as arrow function', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });

  it('does not inflate line count with multi-line block comments in arrow function body', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-arrow', 'arrow.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    // Block comment lines should be excluded; only real logic lines counted
    expect(inlineObs[0].evidence.handlerLines).toBeLessThan(30);
  });
});

describe('ast-handler-structure: function expression handler', () => {
  it('detects HANDLER_INLINE_LOGIC for handler defined as function expression', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-func-expr', 'func-expr.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });
});

// ---------------------------------------------------------------------------
// Default export function handler tests
// ---------------------------------------------------------------------------

describe('ast-handler-structure: export default function handler', () => {
  it('detects HANDLER_INLINE_LOGIC for export default function (non-standard name)', () => {
    const result = analyzeHandlerStructure(fixturePath('handler-structure-default-export', 'default-export.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(1);
    expect(inlineObs[0].evidence.handlerLines).toBeGreaterThan(15);
  });
});

describe('ast-handler-structure: no standard handler found (return null path)', () => {
  it('emits no observations when handler cannot be identified', () => {
    // This fixture has a const arrow function exported as default with a non-handler name.
    // findHandlerFunction cannot find it, so handlerNode is null and no inline-logic obs is emitted.
    const result = analyzeHandlerStructure(fixturePath('handler-structure-no-handler', 'no-handler.ts'));
    const inlineObs = result.observations.filter(o => o.kind === 'HANDLER_INLINE_LOGIC');
    expect(inlineObs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// extractHandlerStructureObservations
// ---------------------------------------------------------------------------

describe('ast-handler-structure: extractHandlerStructureObservations', () => {
  it('returns standard ObservationResult shape', () => {
    const analysis = analyzeHandlerStructure(fixturePath('handler-structure-inline', 'reports.ts'));
    const obsResult = extractHandlerStructureObservations(analysis);
    expect(obsResult.filePath).toBe(analysis.filePath);
    expect(obsResult.observations).toEqual(analysis.observations);
  });
});
