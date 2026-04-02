import path from 'path';
import fs from 'fs';
import { PROJECT_ROOT } from './project';
import { getFilesInDirectory, type FileFilter } from './shared';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { astConfig } from './ast-config';
import { analyzeComplexity, analyzeComplexityDirectory } from './ast-complexity';
import { buildDependencyGraph } from './ast-imports';
import type { TestCoverageObservation, TestCoverageAnalysis, ObservationResult, ComplexityAnalysis } from './types';

// ---------------------------------------------------------------------------
// Spec file discovery
// ---------------------------------------------------------------------------

/**
 * Find a dedicated spec file for a production file.
 * Checks:
 *   - __tests__/<basename>.spec.ts (sibling __tests__ directory)
 *   - <basename>.spec.ts (adjacent)
 *   - __tests__/<basename>.spec.tsx
 *   - <basename>.spec.tsx
 */
function findDedicatedSpec(filePath: string): string | null {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);

  const candidates = [
    path.join(dir, '__tests__', `${basename}.spec.ts`),
    path.join(dir, `${basename}.spec.ts`),
    path.join(dir, '__tests__', `${basename}.spec.tsx`),
    path.join(dir, `${basename}.spec.tsx`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.relative(PROJECT_ROOT, candidate);
    }
  }

  return null;
}

/**
 * Find spec files that import a given production file (indirect coverage).
 * Uses the import graph edges to find which .spec.ts/.spec.tsx files
 * depend on this file.
 */
function findIndirectSpecs(
  fileRelativePath: string,
  edges: { from: string; to: string; specifiers: string[] }[],
): string[] {
  const specPattern = /\.spec\.tsx?$/;
  const specs: string[] = [];

  for (const edge of edges) {
    if (edge.to === fileRelativePath && specPattern.test(edge.from)) {
      specs.push(edge.from);
    }
  }

  return specs;
}

// ---------------------------------------------------------------------------
// Risk computation
// ---------------------------------------------------------------------------

function computeRiskScore(maxCC: number, lineCount: number, consumerCount: number): number {
  return maxCC / 5 + lineCount / 100 + consumerCount / 10;
}

function classifyRisk(
  riskScore: number,
  coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED',
): 'HIGH' | 'MEDIUM' | 'LOW' {
  const { riskHighThreshold, riskMediumThreshold } = astConfig.testCoverage;

  if (coverage === 'UNTESTED' && riskScore >= riskHighThreshold) return 'HIGH';
  if (coverage === 'UNTESTED' && riskScore >= riskMediumThreshold) return 'MEDIUM';
  // INDIRECTLY_TESTED files only escalate to MEDIUM at the HIGH threshold.
  // Medium-risk INDIRECTLY_TESTED files stay LOW because indirect coverage
  // provides sufficient safety for moderate complexity.
  if (coverage === 'INDIRECTLY_TESTED' && riskScore >= riskHighThreshold) return 'MEDIUM';
  return 'LOW';
}

function assignPriority(
  risk: 'HIGH' | 'MEDIUM' | 'LOW',
  coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED',
): 'P2' | 'P3' | 'P4' {
  if (risk === 'HIGH' && coverage === 'UNTESTED') return 'P2';
  if ((risk === 'MEDIUM' && coverage === 'UNTESTED') || (risk === 'HIGH' && coverage === 'INDIRECTLY_TESTED'))
    return 'P3';
  if ((risk === 'LOW' && coverage === 'UNTESTED') || (risk === 'MEDIUM' && coverage === 'INDIRECTLY_TESTED'))
    return 'P4';
  return 'P4';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TestCoverageResult {
  filePath: string;
  specFile: string | null;
  indirectSpecs: string[];
  coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED';
  riskScore: number;
  risk: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedPriority: 'P2' | 'P3' | 'P4';
  maxCC: number;
  lineCount: number;
  consumerCount: number;
}

/**
 * Analyze test coverage for a single production file.
 * Requires pre-computed complexity and import graph data.
 */
export function analyzeTestCoverageForFile(
  filePath: string,
  complexityMap: Map<string, ComplexityAnalysis>,
  edges: { from: string; to: string; specifiers: string[] }[],
): TestCoverageResult {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  // Find spec files
  const specFile = findDedicatedSpec(absolute);
  const indirectSpecs = findIndirectSpecs(relativePath, edges);

  // Determine coverage
  let coverage: 'TESTED' | 'INDIRECTLY_TESTED' | 'UNTESTED';
  if (specFile) {
    coverage = 'TESTED';
  } else if (indirectSpecs.length > 0) {
    coverage = 'INDIRECTLY_TESTED';
  } else {
    coverage = 'UNTESTED';
  }

  // Get complexity data
  const complexityData = complexityMap.get(relativePath);
  const maxCC = complexityData ? Math.max(1, ...complexityData.functions.map(f => f.cyclomaticComplexity)) : 1;

  // Count file lines
  let lineCount: number;
  try {
    const content = fs.readFileSync(absolute, 'utf-8');
    lineCount = content.split('\n').length;
  } catch {
    lineCount = 0;
  }

  // Count consumers from edges
  const consumerCount = edges.filter(e => e.to === relativePath).length;

  // Compute risk
  const riskScore = computeRiskScore(maxCC, lineCount, consumerCount);
  const risk = classifyRisk(riskScore, coverage);
  const suggestedPriority = assignPriority(risk, coverage);

  return {
    filePath: relativePath,
    specFile,
    indirectSpecs,
    coverage,
    riskScore: Math.round(riskScore * 100) / 100,
    risk,
    suggestedPriority,
    maxCC,
    lineCount,
    consumerCount,
  };
}

/**
 * Analyze test coverage for all production files in a directory.
 */
export function analyzeTestCoverageDirectory(
  dirPath: string,
  options: { filter?: FileFilter } = {},
): TestCoverageResult[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production').filter(
    fp => !fp.endsWith('.stories.ts') && !fp.endsWith('.stories.tsx'),
  );

  // Pre-compute complexity for all files
  const complexityResults = analyzeComplexityDirectory(dirPath, { filter: options.filter ?? 'production' });
  const complexityMap = new Map<string, ComplexityAnalysis>();
  for (const result of complexityResults) {
    complexityMap.set(result.filePath, result);
  }

  // Build import graph to find edges (including test file edges).
  // Scope the consumer search to the analyzed directory to avoid
  // expensive cross-repo rg scans for small fixture directories.
  const graph = buildDependencyGraph(dirPath, { filter: 'all', searchDir: absolute });
  const edges = graph.edges;

  const results: TestCoverageResult[] = [];
  for (const fp of filePaths) {
    results.push(analyzeTestCoverageForFile(fp, complexityMap, edges));
  }

  // Sort by riskScore descending
  results.sort((a, b) => b.riskScore - a.riskScore);

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractTestCoverageObservations(
  result: TestCoverageResult,
): ObservationResult<TestCoverageObservation> {
  const observation: TestCoverageObservation = {
    kind: 'TEST_COVERAGE',
    file: result.filePath,
    line: 1,
    evidence: {
      specFile: result.specFile,
      indirectSpecs: result.indirectSpecs,
      coverage: result.coverage,
      riskScore: result.riskScore,
      risk: result.risk,
      suggestedPriority: result.suggestedPriority,
      maxCC: result.maxCC,
      lineCount: result.lineCount,
      consumerCount: result.consumerCount,
    },
  };

  return {
    filePath: result.filePath,
    observations: [observation],
  };
}

export function extractTestCoverageAnalysis(results: TestCoverageResult[]): TestCoverageAnalysis[] {
  return results.map(result => ({
    filePath: result.filePath,
    observations: [extractTestCoverageObservations(result).observations[0]],
  }));
}

// ---------------------------------------------------------------------------
// CLI wrappers (single-file builds its own context)
// ---------------------------------------------------------------------------

function analyzeTestCoverageFileWrapped(filePath: string): TestCoverageAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const dir = path.dirname(absolute);
  const complexityResult = analyzeComplexity(filePath);
  const complexityMap = new Map<string, ComplexityAnalysis>();
  complexityMap.set(complexityResult.filePath, complexityResult);

  const graph = buildDependencyGraph(dir, { filter: 'all' });
  const result = analyzeTestCoverageForFile(filePath, complexityMap, graph.edges);
  return {
    filePath: result.filePath,
    observations: [extractTestCoverageObservations(result).observations[0]],
  };
}

function analyzeTestCoverageDirectoryWrapped(dirPath: string): TestCoverageAnalysis[] {
  const coverageResults = analyzeTestCoverageDirectory(dirPath);
  return extractTestCoverageAnalysis(coverageResults);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-test-coverage.ts <path...> [--pretty] [--kind <kind>] [--count]\n' +
  '\n' +
  'Analyze test coverage status and risk-based priority for production files.\n' +
  '\n' +
  '  <path...>     One or more directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<TestCoverageAnalysis> = {
  cacheNamespace: 'ast-test-coverage',
  helpText: HELP_TEXT,
  analyzeFile: analyzeTestCoverageFileWrapped,
  analyzeDirectory: analyzeTestCoverageDirectoryWrapped,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-test-coverage.ts') || process.argv[1].endsWith('ast-test-coverage'));
if (isDirectRun) runObservationToolCli(cliConfig);
