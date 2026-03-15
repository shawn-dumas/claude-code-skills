/**
 * Tool registry mapping tool names to their observation analyzers.
 *
 * Each registered tool has a thin adapter that normalizes the tool's
 * native API into a common `(sourceFile, filePath) => AnyObservation[]`
 * signature. Tools that need intermediate analysis (complexity, data-layer,
 * imports, test-parity, test-analysis, react-inventory) are adapted to
 * work from a filePath since their internal APIs require it.
 */

import type { SourceFile } from 'ts-morph';
import type { AnyObservation } from './types';

// Tool imports -- each tool's observation extraction function
import { analyzeComplexity, extractComplexityObservations } from './ast-complexity';
import { analyzeDataLayer, extractDataLayerObservations } from './ast-data-layer';
import { extractEnvObservations } from './ast-env-access';
import { extractFeatureFlagObservations } from './ast-feature-flags';
import { extractJsxObservations } from './ast-jsx-analysis';
import { analyzeReactFile } from './ast-react-inventory';
import { extractSideEffectObservations } from './ast-side-effects';
import { extractStorageObservations } from './ast-storage-access';
import { analyzeTestFile } from './ast-test-analysis';
import { analyzeTestParity, extractTestParityObservations } from './ast-test-parity';
import { extractTypeSafetyObservations } from './ast-type-safety';

// ast-imports: SourceFile-based extraction for virtual/HEAD content
import { extractImportObservationsFromSource } from './ast-imports';

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

export interface ToolEntry {
  readonly name: string;
  readonly analyze: (sourceFile: SourceFile, filePath: string) => AnyObservation[];
}

// ---------------------------------------------------------------------------
// Tool adapters
// ---------------------------------------------------------------------------

function complexityAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  const analysis = analyzeComplexity(filePath);
  const result = extractComplexityObservations(analysis);
  return [...result.observations];
}

function dataLayerAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  const analysis = analyzeDataLayer(filePath);
  const result = extractDataLayerObservations(analysis);
  return [...result.observations];
}

function envAccessAdapter(sf: SourceFile, _filePath: string): AnyObservation[] {
  return extractEnvObservations(sf);
}

function featureFlagsAdapter(sf: SourceFile, _filePath: string): AnyObservation[] {
  return extractFeatureFlagObservations(sf);
}

function importsAdapter(sf: SourceFile, filePath: string): AnyObservation[] {
  const result = extractImportObservationsFromSource(sf, filePath);
  return [...result.observations];
}

function jsxAnalysisAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  return extractJsxObservations(filePath);
}

function reactInventoryAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  const inventory = analyzeReactFile(filePath);
  const observations: AnyObservation[] = [];
  observations.push(...inventory.hookObservations);
  observations.push(...inventory.componentObservations);
  for (const comp of inventory.components) {
    observations.push(...comp.effectObservations);
  }
  return observations;
}

function sideEffectsAdapter(sf: SourceFile, _filePath: string): AnyObservation[] {
  return extractSideEffectObservations(sf);
}

function storageAccessAdapter(sf: SourceFile, _filePath: string): AnyObservation[] {
  return extractStorageObservations(sf);
}

function testAnalysisAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  const analysis = analyzeTestFile(filePath);
  return [...analysis.observations];
}

function testParityAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  const inventory = analyzeTestParity(filePath);
  const result = extractTestParityObservations(inventory);
  return [...result.observations];
}

function typeSafetyAdapter(_sf: SourceFile, filePath: string): AnyObservation[] {
  return extractTypeSafetyObservations(filePath);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const entries: ToolEntry[] = [
  { name: 'complexity', analyze: complexityAdapter },
  { name: 'data-layer', analyze: dataLayerAdapter },
  { name: 'env-access', analyze: envAccessAdapter },
  { name: 'feature-flags', analyze: featureFlagsAdapter },
  { name: 'imports', analyze: importsAdapter },
  { name: 'jsx-analysis', analyze: jsxAnalysisAdapter },
  { name: 'react-inventory', analyze: reactInventoryAdapter },
  { name: 'side-effects', analyze: sideEffectsAdapter },
  { name: 'storage-access', analyze: storageAccessAdapter },
  { name: 'test-analysis', analyze: testAnalysisAdapter },
  { name: 'test-parity', analyze: testParityAdapter },
  { name: 'type-safety', analyze: typeSafetyAdapter },
];

export const TOOL_REGISTRY: ReadonlyMap<string, ToolEntry> = new Map(entries.map(e => [e.name, e]));

/**
 * Run all registered observation tools on a single source file.
 */
export function runAllObservers(sourceFile: SourceFile, filePath: string): AnyObservation[] {
  const observations: AnyObservation[] = [];
  for (const entry of entries) {
    observations.push(...entry.analyze(sourceFile, filePath));
  }
  return observations;
}

/**
 * Run a subset of observation tools by name.
 * Throws if any tool name is not found in the registry.
 */
export function runObservers(sourceFile: SourceFile, filePath: string, toolNames: string[]): AnyObservation[] {
  const observations: AnyObservation[] = [];
  for (const name of toolNames) {
    const entry = TOOL_REGISTRY.get(name);
    if (!entry) {
      throw new Error(`Unknown tool name: '${name}'. Available: ${getToolNames().join(', ')}`);
    }
    observations.push(...entry.analyze(sourceFile, filePath));
  }
  return observations;
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): string[] {
  return entries.map(e => e.name);
}
