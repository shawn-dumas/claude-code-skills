/**
 * Smoke tests for every AST tool.
 *
 * These tests verify that each tool can analyze a fixture file without
 * throwing. They do not assert on specific observations -- individual
 * tool specs handle that. The goal is to catch "tool blows up on basic
 * invocation" regressions like the storage-access cache collision bug.
 *
 * Two layers:
 * 1. Registry tools: runObservers with each registered tool name
 * 2. Per-tool analysis: the exported analyze* function for each tool
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { getToolNames, runObservers } from '../tool-registry';
import { getSourceFile } from '../project';

// Per-tool imports for direct analysis smoke tests
import { analyzeStorageAccess, analyzeStorageAccessDirectory } from '../ast-storage-access';
import { analyzeJsxComplexity, analyzeJsxComplexityDirectory } from '../ast-jsx-analysis';
import { analyzeReactFile, analyzeReactFileDirectory } from '../ast-react-inventory';
import { analyzeSideEffects, analyzeSideEffectsDirectory } from '../ast-side-effects';
import { analyzeComplexity, analyzeComplexityDirectory } from '../ast-complexity';
import { analyzeTypeSafety, analyzeTypeSafetyDirectory } from '../ast-type-safety';
import { analyzeEnvAccess, analyzeEnvAccessDirectory } from '../ast-env-access';
import { analyzeFeatureFlags, analyzeFeatureFlagsDirectory } from '../ast-feature-flags';
import { analyzeAuthZ, analyzeAuthZDirectory } from '../ast-authz-audit';
import { analyzeConcernMatrix, analyzeConcernMatrixDirectory } from '../ast-concern-matrix';
import { analyzeErrorCoverage, analyzeErrorCoverageDirectory } from '../ast-error-coverage';
import { analyzeExportSurface, analyzeExportSurfaceDirectory } from '../ast-export-surface';
import { analyzeDataLayer, analyzeDataLayerDirectory } from '../ast-data-layer';
import { analyzeHandlerStructure, analyzeHandlerStructureDirectory } from '../ast-handler-structure';
import { analyzeBrandedCheck, analyzeBrandedCheckDirectory } from '../ast-branded-check';
import { analyzeBehavioral, analyzeBehavioralDirectory } from '../ast-behavioral';
import { analyzeNumberFormat, analyzeNumberFormatDirectory } from '../ast-number-format';
import { analyzeNullDisplay, analyzeNullDisplayDirectory } from '../ast-null-display';
import { analyzeTestFile, analyzeTestDirectory } from '../ast-test-analysis';
import { analyzeDateHandling } from '../ast-date-handling';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

// ---------------------------------------------------------------------------
// Layer 1: Registry smoke -- every registered tool via runObservers
// ---------------------------------------------------------------------------

describe('registry smoke: every tool runs without throwing', () => {
  // Use a fixture that has a broad surface: imports, JSX, hooks, effects,
  // storage calls, etc. simple-component.tsx is a good candidate because
  // it is always present and is a valid TSX file. Tools that find nothing
  // in it still must not throw.
  const componentFixture = fixturePath('simple-component.tsx');

  const toolNames = getToolNames();

  // Dynamically generate one test per registered tool
  it.each(toolNames)('tool "%s" does not throw on a component fixture', toolName => {
    const sf = getSourceFile(componentFixture);
    // runObservers must return an array (possibly empty), never throw
    const result = runObservers(sf, componentFixture, [toolName]);
    expect(Array.isArray(result)).toBe(true);
  });

  // Also run against a plain TS file (non-JSX) to catch tools that assume JSX
  const plainFixture = fixturePath('complexity-samples.ts');

  it.each(toolNames)('tool "%s" does not throw on a plain TS fixture', toolName => {
    const sf = getSourceFile(plainFixture);
    const result = runObservers(sf, plainFixture, [toolName]);
    expect(Array.isArray(result)).toBe(true);
  });

  // Run against a test file to catch tools that might choke on spec patterns
  const testFixture = fixturePath('test-file.spec.ts');

  it.each(toolNames)('tool "%s" does not throw on a test fixture', toolName => {
    const sf = getSourceFile(testFixture);
    const result = runObservers(sf, testFixture, [toolName]);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer 2: Per-tool analyze* functions -- single file
// ---------------------------------------------------------------------------

describe('per-tool single-file smoke tests', () => {
  // Each entry: [description, function, fixture file]
  const singleFileTests: [string, (fp: string) => unknown, string][] = [
    ['analyzeStorageAccess', analyzeStorageAccess, 'storage-access-samples.ts'],
    ['analyzeJsxComplexity', analyzeJsxComplexity, 'component-with-jsx-complexity.tsx'],
    ['analyzeReactFile', analyzeReactFile, 'simple-component.tsx'],
    ['analyzeSideEffects', analyzeSideEffects, 'side-effects-samples.ts'],
    ['analyzeComplexity', analyzeComplexity, 'complexity-samples.ts'],
    ['analyzeTypeSafety', analyzeTypeSafety, 'type-safety-violations.ts'],
    ['analyzeEnvAccess', analyzeEnvAccess, 'env-access-samples.ts'],
    ['analyzeFeatureFlags', analyzeFeatureFlags, 'feature-flag-samples.tsx'],
    ['analyzeAuthZ', analyzeAuthZ, 'authz-positive.tsx'],
    ['analyzeConcernMatrix', analyzeConcernMatrix, 'concern-matrix-samples.tsx'],
    ['analyzeErrorCoverage', analyzeErrorCoverage, 'simple-component.tsx'],
    ['analyzeExportSurface', analyzeExportSurface, 'dead-export.ts'],
    ['analyzeDataLayer', analyzeDataLayer, 'data-layer-samples.ts'],
    ['analyzeHandlerStructure', analyzeHandlerStructure, 'complexity-samples.ts'],
    ['analyzeBrandedCheck', fp => analyzeBrandedCheck(fp), 'simple-component.tsx'],
    ['analyzeBehavioral', analyzeBehavioral, 'behavioral-samples.tsx'],
    ['analyzeNumberFormat', analyzeNumberFormat, 'number-format-samples.ts'],
    ['analyzeNullDisplay', analyzeNullDisplay, 'null-display-samples.tsx'],
    ['analyzeTestFile', analyzeTestFile, 'test-file.spec.ts'],
    ['analyzeDateHandling', analyzeDateHandling, 'simple-component.tsx'],
  ];

  it.each(singleFileTests)('%s does not throw', (_name, analyzeFn, fixture) => {
    const result = analyzeFn(fixturePath(fixture));
    expect(result).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Layer 3: Per-tool directory analysis functions
// ---------------------------------------------------------------------------

describe('per-tool directory smoke tests', () => {
  // These all take a directory path and return an array. They must not throw.
  const directoryTests: [string, (dir: string, opts?: { noCache?: boolean }) => unknown[]][] = [
    ['analyzeStorageAccessDirectory', (d, o) => analyzeStorageAccessDirectory(d, o)],
    ['analyzeJsxComplexityDirectory', (d, o) => analyzeJsxComplexityDirectory(d, o)],
    ['analyzeReactFileDirectory', (d, o) => analyzeReactFileDirectory(d, o)],
    ['analyzeSideEffectsDirectory', (d, o) => analyzeSideEffectsDirectory(d, o)],
    ['analyzeComplexityDirectory', (d, o) => analyzeComplexityDirectory(d, o)],
    ['analyzeTypeSafetyDirectory', (d, o) => analyzeTypeSafetyDirectory(d, o)],
    ['analyzeEnvAccessDirectory', (d, o) => analyzeEnvAccessDirectory(d, o)],
    ['analyzeFeatureFlagsDirectory', (d, o) => analyzeFeatureFlagsDirectory(d, o)],
    ['analyzeAuthZDirectory', (d, o) => analyzeAuthZDirectory(d, o)],
    ['analyzeConcernMatrixDirectory', (d, o) => analyzeConcernMatrixDirectory(d, o)],
    ['analyzeErrorCoverageDirectory', (d, o) => analyzeErrorCoverageDirectory(d, o)],
    ['analyzeExportSurfaceDirectory', (d, o) => analyzeExportSurfaceDirectory(d, o)],
    ['analyzeDataLayerDirectory', (d, o) => analyzeDataLayerDirectory(d, o)],
    ['analyzeHandlerStructureDirectory', (d, o) => analyzeHandlerStructureDirectory(d, o)],
    ['analyzeBrandedCheckDirectory', (d, o) => analyzeBrandedCheckDirectory(d, o)],
    ['analyzeBehavioralDirectory', (d, o) => analyzeBehavioralDirectory(d, o)],
    ['analyzeNumberFormatDirectory', (d, o) => analyzeNumberFormatDirectory(d, o)],
    ['analyzeNullDisplayDirectory', (d, o) => analyzeNullDisplayDirectory(d, o)],
    ['analyzeTestDirectory', (d, o) => analyzeTestDirectory(d, o)],
  ];

  it.each(directoryTests)('%s does not throw on fixtures dir', (_name, analyzeFn) => {
    const result = analyzeFn(FIXTURES_DIR);
    expect(Array.isArray(result)).toBe(true);
  });
});
