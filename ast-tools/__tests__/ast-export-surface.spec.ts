import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeExportSurface, extractExportSurfaceObservations } from '../ast-export-surface';
import type { ExportSurfaceAnalysis, ExportSurfaceObservation } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): ExportSurfaceAnalysis {
  return analyzeExportSurface(fixturePath(name));
}

function findExport(analysis: ExportSurfaceAnalysis, name: string): ExportSurfaceObservation {
  const exp = analysis.observations.find(e => e.evidence.name === name);
  if (!exp) throw new Error(`Export "${name}" not found in analysis`);
  return exp;
}

describe('ast-export-surface', () => {
  const result = analyzeFixture('export-surface-samples.ts');

  it('detects named function export', () => {
    const exp = findExport(result, 'greet');
    expect(exp.evidence.exportKind).toBe('function');
    expect(exp.evidence.isTypeOnly).toBe(false);
    expect(exp.evidence.source).toBeUndefined();
  });

  it('detects const export', () => {
    const exp = findExport(result, 'MAX_RETRIES');
    expect(exp.evidence.exportKind).toBe('const');
    expect(exp.evidence.isTypeOnly).toBe(false);
  });

  it('classifies arrow function const as function', () => {
    const exp = findExport(result, 'add');
    expect(exp.evidence.exportKind).toBe('function');
    expect(exp.evidence.isTypeOnly).toBe(false);
  });

  it('detects type export as type-only', () => {
    const exp = findExport(result, 'UserId');
    expect(exp.evidence.exportKind).toBe('type');
    expect(exp.evidence.isTypeOnly).toBe(true);
  });

  it('detects interface export as type-only', () => {
    const exp = findExport(result, 'Config');
    expect(exp.evidence.exportKind).toBe('interface');
    expect(exp.evidence.isTypeOnly).toBe(true);
  });

  it('detects enum export', () => {
    const exp = findExport(result, 'Status');
    expect(exp.evidence.exportKind).toBe('enum');
    expect(exp.evidence.isTypeOnly).toBe(false);
  });

  it('detects class export', () => {
    const exp = findExport(result, 'Logger');
    expect(exp.evidence.exportKind).toBe('class');
    expect(exp.evidence.isTypeOnly).toBe(false);
  });

  it('detects default export', () => {
    const exp = findExport(result, 'default');
    expect(exp.evidence.exportKind).toBe('default');
    expect(exp.evidence.isTypeOnly).toBe(false);
  });

  it('detects named reexport with source', () => {
    const exp = findExport(result, 'readFileSync');
    expect(exp.evidence.exportKind).toBe('reexport');
    expect(exp.evidence.isTypeOnly).toBe(false);
    expect(exp.evidence.source).toBe('fs');
  });

  it('detects namespace reexport (export *) with source', () => {
    const exp = findExport(result, '*');
    expect(exp.evidence.exportKind).toBe('reexport');
    expect(exp.evidence.isTypeOnly).toBe(false);
    expect(exp.evidence.source).toBe('path');
  });

  it('detects type-only reexport', () => {
    const exp = findExport(result, 'Dirent');
    expect(exp.evidence.exportKind).toBe('reexport');
    expect(exp.evidence.isTypeOnly).toBe(true);
    expect(exp.evidence.source).toBe('fs');
  });

  it('all observations have kind EXPORT_SURFACE', () => {
    expect(result.observations.every(e => e.kind === 'EXPORT_SURFACE')).toBe(true);
  });

  it('all observations have line numbers > 0', () => {
    expect(result.observations.every(e => e.line > 0)).toBe(true);
  });

  it('extractExportSurfaceObservations returns standard ObservationResult', () => {
    const obsResult = extractExportSurfaceObservations(result);
    expect(obsResult.filePath).toBe(result.filePath);
    expect(obsResult.observations).toEqual(result.observations);
  });
});
