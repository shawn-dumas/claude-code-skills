import path from 'path';
import fs from 'fs';
import { Node } from 'ts-morph';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { findExpectInChain } from './shared';
import { analyzeTestFile } from './ast-test-analysis';
import { astConfig, type AstConfig } from './ast-config';
import { createVirtualProject } from './git-source';
import { cachedDirectory } from './ast-cache';
import type {
  TestObservation,
  TestQualityAssessment,
  TestQualityAssessmentKind,
  TestHelperEntry,
  TestHelperIndex,
  ObservationRef,
  AssessmentResult,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassificationResult {
  kind: TestQualityAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
}

type DetectedStrategy = 'playwright' | 'integration-providers' | 'unit-render' | 'unit-pure';

// ---------------------------------------------------------------------------
// Helper file analysis
// ---------------------------------------------------------------------------

/**
 * Classify a single assertion's matcher as user-visible or implementation-detail.
 * Reuses the same classification logic as classifyAssertion but operates
 * on the matcher name alone (helper files don't have the full observation context).
 */
function classifyMatcherName(matcherName: string, config: AstConfig): 'user-visible' | 'implementation' {
  if (config.testing.userVisibleMatchers.has(matcherName)) return 'user-visible';
  if (config.testing.snapshotMatchers.has(matcherName)) return 'implementation';
  if (config.testing.calledMatchers.has(matcherName)) return 'implementation';
  return 'implementation';
}

/**
 * Analyze a Vitest test helper file and return per-function assertion summaries.
 * For each exported function, counts assertion calls and classifies each
 * as user-visible or implementation-detail.
 */
export function analyzeTestHelper(filePath: string, config: AstConfig = astConfig): TestHelperEntry[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(absolute)) return [];

  const project = createVirtualProject();
  const content = fs.readFileSync(absolute, 'utf-8');
  const virtualPath = path.join(PROJECT_ROOT, '__test_helper_virtual__', path.basename(absolute));
  const sf = project.createSourceFile(virtualPath, content);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const entries: TestHelperEntry[] = [];

  sf.forEachDescendant(node => {
    // Standalone function declarations
    if (Node.isFunctionDeclaration(node) && node.getName()) {
      const funcName = node.getName()!;
      const counts = countAndClassifyAssertions(node, config);
      entries.push({
        functionName: funcName,
        file: relativePath,
        line: node.getStartLineNumber(),
        ...counts,
      });
      return;
    }

    // Arrow functions assigned to const
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (!init) return;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) return;

      const funcName = node.getName();
      const counts = countAndClassifyAssertions(init, config);
      entries.push({
        functionName: funcName,
        file: relativePath,
        line: node.getStartLineNumber(),
        ...counts,
      });
    }
  });

  return entries;
}

/**
 * Count and classify expect().toXxx() assertions inside a node.
 */
function countAndClassifyAssertions(
  node: Node,
  config: AstConfig,
): { assertionCount: number; userVisibleCount: number; implementationCount: number } {
  let assertionCount = 0;
  let userVisibleCount = 0;
  let implementationCount = 0;
  const seen = new Set<number>();

  node.forEachDescendant(inner => {
    if (!Node.isCallExpression(inner)) return;
    const expr = inner.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();
    if (!methodName.startsWith('to')) return;

    const expectCall = findExpectInChain(inner);
    if (!expectCall) return;

    const line = inner.getStartLineNumber();
    if (seen.has(line)) return;
    seen.add(line);

    assertionCount++;
    const classification = classifyMatcherName(methodName, config);
    if (classification === 'user-visible') {
      userVisibleCount++;
    } else {
      implementationCount++;
    }
  });

  return { assertionCount, userVisibleCount, implementationCount };
}

/**
 * Resolve a relative or aliased import source to an absolute file path.
 * Returns null if the source cannot be resolved.
 */
function resolveHelperSourcePath(sourceFile: string, testFileDir: string): string | null {
  if (!sourceFile) return null;

  // Aliased paths (@/) -- try each alias prefix in order
  if (sourceFile.startsWith('@/')) {
    const aliasPrefixes = ['src/ui/', 'src/shared/', 'src/fixtures/', 'src/'];
    const suffix = sourceFile.slice(2); // strip @/
    const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
    for (const prefix of aliasPrefixes) {
      const aliasedPath = prefix + suffix;
      for (const ext of extensions) {
        const candidate = path.resolve(PROJECT_ROOT, aliasedPath + ext);
        if (fs.existsSync(candidate)) return candidate;
      }
      const exact = path.resolve(PROJECT_ROOT, aliasedPath);
      if (fs.existsSync(exact)) return exact;
    }
    return null;
  }

  // Relative paths
  if (sourceFile.startsWith('.')) {
    const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const candidate = path.resolve(testFileDir, sourceFile + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
    const exact = path.resolve(testFileDir, sourceFile);
    if (fs.existsSync(exact)) return exact;
    return null;
  }

  return null;
}

/**
 * Build the test helper index from TEST_HELPER_DELEGATION observations.
 * Follows import sources from delegations, resolves them to files, and
 * analyzes each file for assertion content.
 *
 * Cached at the directory level via cachedDirectory().
 */
export function buildTestHelperIndex(
  delegations: readonly TestObservation[],
  testFileDir: string,
  config: AstConfig = astConfig,
): TestHelperIndex {
  const entries = new Map<string, TestHelperEntry>();

  // Collect unique source files from imported delegations
  const sourceFiles = new Set<string>();
  for (const obs of delegations) {
    if (obs.kind !== 'TEST_HELPER_DELEGATION') continue;
    if (!obs.evidence.isImported || !obs.evidence.sourceFile) continue;
    sourceFiles.add(obs.evidence.sourceFile);
  }

  // Resolve and analyze each helper source file
  const resolvedFiles: string[] = [];
  for (const source of sourceFiles) {
    const resolved = resolveHelperSourcePath(source, testFileDir);
    if (!resolved) continue;
    resolvedFiles.push(resolved);
  }

  // Use directory-level caching when there are helper files to analyze
  if (resolvedFiles.length > 0) {
    const helperDir = path.dirname(resolvedFiles[0]);
    const cachedResult = cachedDirectory<TestHelperEntry[]>(
      'ast-test-quality-helpers',
      helperDir,
      resolvedFiles,
      () => {
        const allEntries: TestHelperEntry[] = [];
        for (const resolved of resolvedFiles) {
          const fileEntries = analyzeTestHelper(resolved, config);
          allEntries.push(...fileEntries);
        }
        return allEntries;
      },
    );

    for (const entry of cachedResult) {
      entries.set(entry.functionName, entry);
    }
  }

  return { entries };
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

function buildBasedOn(observation: TestObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

function buildBasedOnMultiple(observations: readonly TestObservation[]): readonly ObservationRef[] {
  return observations.map(obs => ({
    kind: obs.kind,
    file: obs.file,
    line: obs.line,
  }));
}

// ---------------------------------------------------------------------------
// Mock classification
// ---------------------------------------------------------------------------

function isPackageImport(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('@/') && !source.startsWith('/');
}

function classifyMock(
  observation: TestObservation,
  resolvedObservations: Map<string, TestObservation>,
  config: AstConfig,
  subjectDomainDir: string,
): ClassificationResult | null {
  if (observation.kind !== 'MOCK_DECLARATION') return null;

  const target = observation.evidence.target;
  if (!target) return null;

  // Stage 1: Boundary packages (highest priority)
  if (config.testing.boundaryPackages.has(target)) {
    return {
      kind: 'MOCK_BOUNDARY_COMPLIANT',
      confidence: 'high',
      rationale: [`target '${target}' is in boundary packages list`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Stage 2: Boundary path patterns
  const resolvedPath = observation.evidence.resolvedPath;
  if (resolvedPath) {
    for (const pattern of config.testing.boundaryPathPatterns) {
      if (resolvedPath.includes(pattern)) {
        return {
          kind: 'MOCK_BOUNDARY_COMPLIANT',
          confidence: 'high',
          rationale: [`resolved path '${resolvedPath}' matches boundary pattern '${pattern}'`],
          isCandidate: false,
          requiresManualReview: false,
        };
      }
    }
  }

  // Stage 3: Third-party package (not relative, not aliased)
  if (isPackageImport(target)) {
    return {
      kind: 'MOCK_BOUNDARY_COMPLIANT',
      confidence: 'medium',
      rationale: [`target '${target}' is a third-party package`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Stage 4: Check resolved target info
  const mockKey = `${observation.file}:${observation.line}:${target}`;
  const resolvedObs = resolvedObservations.get(mockKey);

  if (resolvedObs?.kind === 'MOCK_TARGET_RESOLVED') {
    const exportNames = resolvedObs.evidence.exportNames ?? [];
    const fileExtension = resolvedObs.evidence.fileExtension ?? '';
    const targetResolvedPath = resolvedObs.evidence.resolvedPath ?? '';

    // Check if target exports hooks
    const targetHasHooks = exportNames.some(
      name => name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase(),
    );

    if (targetHasHooks) {
      // Check if different domain
      if (subjectDomainDir && !targetResolvedPath.startsWith(subjectDomainDir)) {
        return {
          kind: 'MOCK_DOMAIN_BOUNDARY',
          confidence: 'medium',
          rationale: [
            `target exports hooks (${exportNames.filter(n => n.startsWith('use')).join(', ')})`,
            `target path '${targetResolvedPath}' is in different domain from subject`,
            `[near-boundary] between MOCK_INTERNAL_VIOLATION and MOCK_DOMAIN_BOUNDARY`,
          ],
          isCandidate: true,
          requiresManualReview: true,
        };
      }

      return {
        kind: 'MOCK_INTERNAL_VIOLATION',
        confidence: 'high',
        rationale: [
          `mocking own hook: target exports hooks (${exportNames.filter(n => n.startsWith('use')).join(', ')})`,
        ],
        isCandidate: true,
        requiresManualReview: false,
      };
    }

    // Check if target exports components (PascalCase names in .tsx file)
    const hasComponents =
      fileExtension === '.tsx' && exportNames.some(name => name.length > 0 && name[0] >= 'A' && name[0] <= 'Z');

    if (hasComponents) {
      return {
        kind: 'MOCK_INTERNAL_VIOLATION',
        confidence: 'high',
        rationale: [`mocking own component: target is .tsx file with PascalCase exports`],
        isCandidate: true,
        requiresManualReview: false,
      };
    }

    // Otherwise it's mocking own utility
    return {
      kind: 'MOCK_INTERNAL_VIOLATION',
      confidence: 'medium',
      rationale: [`mocking own utility: target is internal module '${target}'`],
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  // Stage 5: Unresolved internal path
  if (target.startsWith('.') || target.startsWith('@/')) {
    return {
      kind: 'MOCK_INTERNAL_VIOLATION',
      confidence: 'low',
      rationale: [
        `unresolved internal path '${target}'`,
        `[near-boundary] path is ambiguous, could be boundary or internal`,
      ],
      isCandidate: true,
      requiresManualReview: true,
    };
  }

  // Fallback: treat as boundary (e.g., bare specifiers we don't recognize)
  return {
    kind: 'MOCK_BOUNDARY_COMPLIANT',
    confidence: 'low',
    rationale: [
      `target '${target}' - could not classify, assuming external`,
      `[near-boundary] classification uncertain, mock target path ambiguous`,
    ],
    isCandidate: false,
    requiresManualReview: true,
  };
}

function classifySpyMock(observation: TestObservation, config: AstConfig): ClassificationResult | null {
  if (observation.kind !== 'SPY_DECLARATION') return null;

  const spyTarget = observation.evidence.spyTarget;
  if (!spyTarget) return null;

  // Check if spying on boundary globals
  if (config.testing.boundaryGlobals.has(spyTarget)) {
    return {
      kind: 'MOCK_BOUNDARY_COMPLIANT',
      confidence: 'high',
      rationale: [`spy target '${spyTarget}' is a boundary global`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Otherwise it's mocking internal
  return {
    kind: 'MOCK_INTERNAL_VIOLATION',
    confidence: 'medium',
    rationale: [`spy on internal object '${spyTarget}'`],
    isCandidate: true,
    requiresManualReview: false,
  };
}

// ---------------------------------------------------------------------------
// Assertion classification
// ---------------------------------------------------------------------------

function classifyAssertion(observation: TestObservation, config: AstConfig): ClassificationResult | null {
  if (observation.kind !== 'ASSERTION_CALL') return null;

  const matcherName = observation.evidence.matcherName;
  const isScreenQuery = observation.evidence.isScreenQuery ?? false;
  const isResultCurrent = observation.evidence.isResultCurrent ?? false;
  const expectArgText = observation.evidence.expectArgText ?? '';

  // Stage 1: Screen queries (testing-library)
  if (isScreenQuery) {
    return {
      kind: 'ASSERTION_USER_VISIBLE',
      confidence: 'high',
      rationale: [`assertion uses screen.* query (testing-library pattern)`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Check for testing library queries in expect arg
  for (const query of config.testing.testingLibraryQueries) {
    if (expectArgText.includes(query)) {
      return {
        kind: 'ASSERTION_USER_VISIBLE',
        confidence: 'high',
        rationale: [`assertion uses testing-library query '${query}'`],
        isCandidate: false,
        requiresManualReview: false,
      };
    }
  }

  // Stage 2: User-visible matchers
  if (matcherName && config.testing.userVisibleMatchers.has(matcherName)) {
    return {
      kind: 'ASSERTION_USER_VISIBLE',
      confidence: 'high',
      rationale: [`matcher '${matcherName}' asserts user-visible state`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Stage 3: Snapshot matchers
  if (matcherName && config.testing.snapshotMatchers.has(matcherName)) {
    return {
      kind: 'ASSERTION_SNAPSHOT',
      confidence: 'high',
      rationale: [`snapshot matcher '${matcherName}' detected`],
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  // Stage 4: Hook return value (result.current)
  if (isResultCurrent) {
    return {
      kind: 'ASSERTION_USER_VISIBLE',
      confidence: 'high',
      rationale: [`assertion on result.current (hook return value is user-visible API)`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Stage 5: Called matchers
  if (matcherName && config.testing.calledMatchers.has(matcherName)) {
    // Check if looks like a prop callback
    if (
      expectArgText.startsWith('props.') ||
      expectArgText.startsWith('on') ||
      expectArgText.includes('OnClick') ||
      expectArgText.includes('OnChange') ||
      expectArgText.includes('OnSubmit')
    ) {
      return {
        kind: 'ASSERTION_USER_VISIBLE',
        confidence: 'high',
        rationale: [`callback-fired assertion: '${matcherName}' on prop callback`],
        isCandidate: false,
        requiresManualReview: false,
      };
    }

    // Check if asserting on a hook mock (use[A-Z] pattern) -- high confidence violation
    if (/use[A-Z]/.test(expectArgText)) {
      return {
        kind: 'ASSERTION_IMPLEMENTATION',
        confidence: 'high',
        rationale: [
          `'${matcherName}' on hook mock '${expectArgText}' -- service hooks are own-project code, not boundaries`,
        ],
        isCandidate: true,
        requiresManualReview: false,
      };
    }

    return {
      kind: 'ASSERTION_IMPLEMENTATION',
      confidence: 'medium',
      rationale: [`'${matcherName}' assertion may be implementation detail`],
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  // Stage 6: Default - implementation detail (low confidence)
  return {
    kind: 'ASSERTION_IMPLEMENTATION',
    confidence: 'low',
    rationale: [`generic assertion, could not classify`],
    isCandidate: false,
    requiresManualReview: false,
  };
}

// ---------------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------------

function detectStrategy(observations: readonly TestObservation[]): {
  strategy: DetectedStrategy;
  confidence: 'high' | 'medium';
  signals: string[];
} {
  const signals: string[] = [];
  let hasPlaywright = false;
  let hasRender = false;
  let hasProvider = false;

  for (const obs of observations) {
    if (obs.kind === 'PLAYWRIGHT_IMPORT') {
      hasPlaywright = true;
      signals.push('PLAYWRIGHT_IMPORT');
    }
    if (obs.kind === 'RENDER_CALL') {
      hasRender = true;
      signals.push(obs.evidence.isRenderHook ? 'RENDER_HOOK_CALL' : 'RENDER_CALL');
    }
    if (obs.kind === 'PROVIDER_WRAPPER') {
      hasProvider = true;
      signals.push(`PROVIDER_WRAPPER(${obs.evidence.providerName ?? 'unknown'})`);
    }
  }

  if (hasPlaywright) {
    return { strategy: 'playwright', confidence: 'high', signals };
  }

  if (hasRender && hasProvider) {
    return { strategy: 'integration-providers', confidence: 'high', signals };
  }

  if (hasRender) {
    return { strategy: 'unit-render', confidence: 'high', signals };
  }

  // No render, no playwright
  return { strategy: 'unit-pure', confidence: signals.length > 0 ? 'medium' : 'high', signals };
}

// ---------------------------------------------------------------------------
// Cleanup assessment
// ---------------------------------------------------------------------------

function assessCleanup(observations: readonly TestObservation[], _file: string): ClassificationResult {
  const afterEachObs = observations.filter(obs => obs.kind === 'AFTER_EACH_BLOCK');
  const cleanupObs = observations.filter(obs => obs.kind === 'CLEANUP_CALL');

  // Check for restoreAllMocks in cleanup
  const hasRestoreAllMocks = cleanupObs.some(
    obs => obs.evidence.cleanupType === 'restoreAllMocks' || obs.evidence.cleanupType === 'clearAllMocks',
  );

  // Per CLAUDE.md: vitest.setup.ts has global afterEach with restoreAllMocks
  // Individual files do NOT need their own restoreAllMocks
  if (afterEachObs.length === 0) {
    return {
      kind: 'CLEANUP_COMPLETE',
      confidence: 'high',
      rationale: ['no local afterEach needed - global cleanup in vitest.setup.ts handles mock restoration'],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Has afterEach - check what cleanup is done
  if (hasRestoreAllMocks) {
    return {
      kind: 'CLEANUP_COMPLETE',
      confidence: 'high',
      rationale: ['local afterEach with mock restoration (redundant with global setup but not harmful)'],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Has afterEach but no standard cleanup patterns
  const cleanupTypes = cleanupObs.map(obs => obs.evidence.cleanupType).filter(Boolean);
  if (cleanupTypes.length > 0) {
    return {
      kind: 'CLEANUP_COMPLETE',
      confidence: 'medium',
      rationale: [`local afterEach with cleanup: ${cleanupTypes.join(', ')}`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  return {
    kind: 'CLEANUP_INCOMPLETE',
    confidence: 'medium',
    rationale: ['afterEach present but no recognized cleanup patterns'],
    isCandidate: true,
    requiresManualReview: false,
  };
}

// ---------------------------------------------------------------------------
// Data sourcing assessment
// ---------------------------------------------------------------------------

function assessDataSourcing(observations: readonly TestObservation[]): ClassificationResult[] {
  const results: ClassificationResult[] = [];

  const fixtureObs = observations.filter(obs => obs.kind === 'FIXTURE_IMPORT');
  const sharedMutableObs = observations.filter(obs => obs.kind === 'SHARED_MUTABLE_IMPORT');

  if (fixtureObs.length > 0) {
    results.push({
      kind: 'DATA_SOURCING_COMPLIANT',
      confidence: 'high',
      rationale: [`uses fixture system: ${fixtureObs.map(o => o.evidence.fixtureSource).join(', ')}`],
      isCandidate: false,
      requiresManualReview: false,
    });
  }

  if (sharedMutableObs.length > 0) {
    results.push({
      kind: 'DATA_SOURCING_VIOLATION',
      confidence: 'medium',
      rationale: [`imports shared mutable constants: ${sharedMutableObs.map(o => o.evidence.importSource).join(', ')}`],
      isCandidate: true,
      requiresManualReview: false,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Delete candidate assessment
// ---------------------------------------------------------------------------

function assessDeleteCandidate(internalMockCount: number, config: AstConfig): ClassificationResult | null {
  if (internalMockCount >= config.testing.deleteThresholdInternalMocks) {
    return {
      kind: 'DELETE_CANDIDATE',
      confidence: 'high',
      rationale: [
        `${internalMockCount} internal mock violations (threshold: ${config.testing.deleteThresholdInternalMocks})`,
        'full rewrite likely cheaper than incremental repair',
      ],
      isCandidate: true,
      requiresManualReview: true,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret test observations and produce quality assessments.
 *
 * Assessment categories:
 * - Mock classification: MOCK_BOUNDARY_COMPLIANT, MOCK_INTERNAL_VIOLATION, MOCK_DOMAIN_BOUNDARY
 * - Assertion classification: ASSERTION_USER_VISIBLE, ASSERTION_IMPLEMENTATION, ASSERTION_SNAPSHOT
 * - Strategy detection: DETECTED_STRATEGY (neutral record)
 * - Cleanup assessment: CLEANUP_COMPLETE, CLEANUP_INCOMPLETE
 * - Data sourcing: DATA_SOURCING_COMPLIANT, DATA_SOURCING_VIOLATION
 * - Triage heuristic: DELETE_CANDIDATE (high internal-mock count)
 * - Orphan detection: ORPHANED_TEST
 *
 * @param observations - Test observations from ast-test-analysis
 * @param config - Repo convention config
 * @param subjectDomainDir - Domain directory of the test subject (for domain boundary detection)
 * @param subjectExists - Whether the subject file exists (for orphan detection)
 * @param helperIndex - Optional pre-built helper index for resolving helper delegations
 * @returns Assessment results
 */
export function interpretTestQuality(
  observations: readonly TestObservation[],
  config: AstConfig = astConfig,
  subjectDomainDir = '',
  subjectExists = true,
  helperIndex?: TestHelperIndex,
): AssessmentResult<TestQualityAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const assessments: TestQualityAssessment[] = [];
  const file = observations[0].file;

  // Build map for MOCK_TARGET_RESOLVED observations
  const resolvedObservations = new Map<string, TestObservation>();
  for (const obs of observations) {
    if (obs.kind === 'MOCK_TARGET_RESOLVED') {
      const key = `${obs.file}:${obs.line}:${obs.evidence.target}`;
      resolvedObservations.set(key, obs);
    }
  }

  // Track internal mock violations for delete candidate assessment
  let internalMockCount = 0;

  // Process mock declarations
  for (const obs of observations) {
    if (obs.kind === 'MOCK_DECLARATION') {
      const result = classifyMock(obs, resolvedObservations, config, subjectDomainDir);
      if (result) {
        if (result.kind === 'MOCK_INTERNAL_VIOLATION') {
          internalMockCount++;
        }
        assessments.push({
          kind: result.kind,
          subject: { file: obs.file, line: obs.line, symbol: obs.evidence.target },
          confidence: result.confidence,
          rationale: result.rationale,
          basedOn: buildBasedOn(obs),
          isCandidate: result.isCandidate,
          requiresManualReview: result.requiresManualReview,
        });
      }
    }

    if (obs.kind === 'SPY_DECLARATION') {
      const result = classifySpyMock(obs, config);
      if (result) {
        if (result.kind === 'MOCK_INTERNAL_VIOLATION') {
          internalMockCount++;
        }
        assessments.push({
          kind: result.kind,
          subject: { file: obs.file, line: obs.line, symbol: obs.evidence.spyTarget },
          confidence: result.confidence,
          rationale: result.rationale,
          basedOn: buildBasedOn(obs),
          isCandidate: result.isCandidate,
          requiresManualReview: result.requiresManualReview,
        });
      }
    }
  }

  // Process assertions
  for (const obs of observations) {
    if (obs.kind === 'ASSERTION_CALL') {
      const result = classifyAssertion(obs, config);
      if (result) {
        assessments.push({
          kind: result.kind,
          subject: { file: obs.file, line: obs.line },
          confidence: result.confidence,
          rationale: result.rationale,
          basedOn: buildBasedOn(obs),
          isCandidate: result.isCandidate,
          requiresManualReview: result.requiresManualReview,
        });
      }
    }
  }

  // Process helper delegations: resolve assertion counts from helper functions
  for (const obs of observations) {
    if (obs.kind !== 'TEST_HELPER_DELEGATION') continue;

    const funcName = obs.evidence.functionName;
    if (!funcName) continue;

    const entry = helperIndex?.entries.get(funcName);

    if (entry) {
      // Resolved: attribute helper's assertions to the calling test
      if (entry.userVisibleCount > 0) {
        assessments.push({
          kind: 'ASSERTION_USER_VISIBLE',
          subject: { file: obs.file, line: obs.line, symbol: funcName },
          confidence: 'medium',
          rationale: [
            `resolved via helper '${funcName}': ${entry.userVisibleCount} user-visible assertion(s) in ${entry.file}:${entry.line}`,
          ],
          basedOn: buildBasedOn(obs),
          isCandidate: false,
          requiresManualReview: false,
        });
      }
      if (entry.implementationCount > 0) {
        assessments.push({
          kind: 'ASSERTION_IMPLEMENTATION',
          subject: { file: obs.file, line: obs.line, symbol: funcName },
          confidence: 'medium',
          rationale: [
            `resolved via helper '${funcName}': ${entry.implementationCount} implementation assertion(s) in ${entry.file}:${entry.line}`,
          ],
          basedOn: buildBasedOn(obs),
          isCandidate: true,
          requiresManualReview: false,
        });
      }
    } else if (obs.evidence.isImported) {
      // Imported but unresolved: flag for manual review
      assessments.push({
        kind: 'ASSERTION_IMPLEMENTATION',
        subject: { file: obs.file, line: obs.line, symbol: funcName },
        confidence: 'low',
        rationale: [`unresolved helper delegation '${funcName}' from '${obs.evidence.sourceFile ?? 'unknown'}'`],
        basedOn: buildBasedOn(obs),
        isCandidate: true,
        requiresManualReview: true,
      });
    }
    // Local helpers (not imported) are skipped -- their assertions
    // are already counted inline in the same file.
  }

  // Strategy assessment (one per file)
  const strategyResult = detectStrategy(observations);
  const strategyObs = observations.filter(
    obs => obs.kind === 'PLAYWRIGHT_IMPORT' || obs.kind === 'RENDER_CALL' || obs.kind === 'PROVIDER_WRAPPER',
  );
  assessments.push({
    kind: 'DETECTED_STRATEGY',
    subject: { file, symbol: strategyResult.strategy },
    confidence: strategyResult.confidence,
    rationale: strategyResult.signals.length > 0 ? strategyResult.signals : ['no strategy signals detected'],
    basedOn: buildBasedOnMultiple(strategyObs.length > 0 ? strategyObs : observations.slice(0, 1)),
    isCandidate: false,
    requiresManualReview: false,
  });

  // Cleanup assessment (one per file)
  const cleanupResult = assessCleanup(observations, file);
  const cleanupObs = observations.filter(obs => obs.kind === 'AFTER_EACH_BLOCK' || obs.kind === 'CLEANUP_CALL');
  assessments.push({
    kind: cleanupResult.kind,
    subject: { file },
    confidence: cleanupResult.confidence,
    rationale: cleanupResult.rationale,
    basedOn: buildBasedOnMultiple(cleanupObs.length > 0 ? cleanupObs : observations.slice(0, 1)),
    isCandidate: cleanupResult.isCandidate,
    requiresManualReview: cleanupResult.requiresManualReview,
  });

  // Data sourcing assessments
  const dataSourcingResults = assessDataSourcing(observations);
  for (const result of dataSourcingResults) {
    const relatedObs = observations.filter(
      obs => obs.kind === 'FIXTURE_IMPORT' || obs.kind === 'SHARED_MUTABLE_IMPORT',
    );
    assessments.push({
      kind: result.kind,
      subject: { file },
      confidence: result.confidence,
      rationale: result.rationale,
      basedOn: buildBasedOnMultiple(relatedObs.length > 0 ? relatedObs : observations.slice(0, 1)),
      isCandidate: result.isCandidate,
      requiresManualReview: result.requiresManualReview,
    });
  }

  // Orphaned test assessment
  if (!subjectExists) {
    assessments.push({
      kind: 'ORPHANED_TEST',
      subject: { file },
      confidence: 'high',
      rationale: ['subject file does not exist'],
      basedOn: buildBasedOnMultiple(observations.slice(0, 1)),
      isCandidate: true,
      requiresManualReview: true,
    });
  }

  // Delete candidate assessment
  const deleteCandidate = assessDeleteCandidate(internalMockCount, config);
  if (deleteCandidate) {
    assessments.push({
      kind: deleteCandidate.kind,
      subject: { file },
      confidence: deleteCandidate.confidence,
      rationale: deleteCandidate.rationale,
      basedOn: buildBasedOnMultiple(
        observations.filter(obs => obs.kind === 'MOCK_DECLARATION' || obs.kind === 'SPY_DECLARATION').slice(0, 5),
      ),
      isCandidate: deleteCandidate.isCandidate,
      requiresManualReview: deleteCandidate.requiresManualReview,
    });
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<TestQualityAssessment>, filePath: string): string {
  const lines: string[] = [];
  lines.push(`Test Quality Assessments: ${filePath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No assessments generated.');
    return lines.join('\n');
  }

  // Group by category
  const mocks = result.assessments.filter(a =>
    ['MOCK_BOUNDARY_COMPLIANT', 'MOCK_INTERNAL_VIOLATION', 'MOCK_DOMAIN_BOUNDARY'].includes(a.kind),
  );
  const assertions = result.assessments.filter(a =>
    ['ASSERTION_USER_VISIBLE', 'ASSERTION_IMPLEMENTATION', 'ASSERTION_SNAPSHOT'].includes(a.kind),
  );
  const strategies = result.assessments.filter(a => a.kind === 'DETECTED_STRATEGY');
  const cleanup = result.assessments.filter(a => ['CLEANUP_COMPLETE', 'CLEANUP_INCOMPLETE'].includes(a.kind));
  const dataSourcing = result.assessments.filter(a =>
    ['DATA_SOURCING_COMPLIANT', 'DATA_SOURCING_VIOLATION'].includes(a.kind),
  );
  const triage = result.assessments.filter(a => ['ORPHANED_TEST', 'DELETE_CANDIDATE'].includes(a.kind));

  if (strategies.length > 0) {
    lines.push('Strategy:');
    for (const a of strategies) {
      lines.push(`  ${a.subject.symbol} (${a.confidence}) - ${a.rationale.join(', ')}`);
    }
    lines.push('');
  }

  if (mocks.length > 0) {
    lines.push('Mocks:');
    lines.push(' Line | Kind                    | Target               | Rationale');
    lines.push('------+-------------------------+----------------------+--------------------------');
    for (const a of mocks) {
      const line = String(a.subject.line ?? '?').padStart(5);
      const kind = a.kind.padEnd(23);
      const target = (a.subject.symbol ?? '?').slice(0, 20).padEnd(20);
      const rationale = a.rationale.join('; ').slice(0, 40);
      lines.push(`${line} | ${kind} | ${target} | ${rationale}`);
    }
    lines.push('');
  }

  if (assertions.length > 0) {
    lines.push('Assertions:');
    const userVisible = assertions.filter(a => a.kind === 'ASSERTION_USER_VISIBLE').length;
    const implementation = assertions.filter(a => a.kind === 'ASSERTION_IMPLEMENTATION').length;
    const snapshot = assertions.filter(a => a.kind === 'ASSERTION_SNAPSHOT').length;
    lines.push(`  USER_VISIBLE: ${userVisible}, IMPLEMENTATION: ${implementation}, SNAPSHOT: ${snapshot}`);
    lines.push('');
  }

  if (cleanup.length > 0) {
    lines.push('Cleanup:');
    for (const a of cleanup) {
      lines.push(`  ${a.kind} (${a.confidence}) - ${a.rationale.join(', ')}`);
    }
    lines.push('');
  }

  if (dataSourcing.length > 0) {
    lines.push('Data Sourcing:');
    for (const a of dataSourcing) {
      lines.push(`  ${a.kind} - ${a.rationale.join(', ')}`);
    }
    lines.push('');
  }

  if (triage.length > 0) {
    lines.push('Triage:');
    for (const a of triage) {
      lines.push(`  ${a.kind} (${a.confidence}) - ${a.rationale.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-test-quality.ts <file|dir> [--pretty]\n' +
        '\n' +
        'Interpret test file observations and classify them.\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  Mocks:\n' +
        '    MOCK_BOUNDARY_COMPLIANT  - Mock targets external boundary\n' +
        '    MOCK_INTERNAL_VIOLATION  - Mocks own hook/component/utility\n' +
        '    MOCK_DOMAIN_BOUNDARY     - Mocks hook from different domain\n' +
        '\n' +
        '  Assertions:\n' +
        '    ASSERTION_USER_VISIBLE   - Asserts on rendered output/aria\n' +
        '    ASSERTION_IMPLEMENTATION - Asserts on implementation details\n' +
        '    ASSERTION_SNAPSHOT       - Snapshot assertion\n' +
        '\n' +
        '  Strategy:\n' +
        '    DETECTED_STRATEGY        - Test strategy detected\n' +
        '\n' +
        '  Cleanup:\n' +
        '    CLEANUP_COMPLETE         - Proper cleanup patterns\n' +
        '    CLEANUP_INCOMPLETE       - Missing cleanup\n' +
        '\n' +
        '  Data Sourcing:\n' +
        '    DATA_SOURCING_COMPLIANT  - Uses fixture system\n' +
        '    DATA_SOURCING_VIOLATION  - Shared mutable constants\n' +
        '\n' +
        '  Triage:\n' +
        '    ORPHANED_TEST            - Subject file not found\n' +
        '    DELETE_CANDIDATE         - High internal-mock count\n' +
        '\n' +
        '  <file|dir>  A test file or directory to analyze\n' +
        '  --pretty    Format output as a human-readable table\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  const targetPath = args.paths[0];
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  if (!fs.existsSync(absolute)) {
    fatal(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(absolute);
  let allAssessments: TestQualityAssessment[] = [];
  let displayPath = targetPath;

  if (stat.isDirectory()) {
    // Find all test files in directory
    const testFiles = findTestFiles(absolute);
    for (const fp of testFiles) {
      try {
        const analysis = analyzeTestFile(fp);
        const delegations = analysis.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');
        const helperIndex =
          delegations.length > 0 ? buildTestHelperIndex(delegations, path.dirname(fp), astConfig) : undefined;
        const result = interpretTestQuality(
          analysis.observations,
          astConfig,
          getDomainDir(analysis.subjectPath),
          analysis.subjectExists,
          helperIndex,
        );
        allAssessments.push(...result.assessments);
      } catch (e) {
        console.error(`Warning: could not analyze ${fp}: ${String(e)}`);
      }
    }
    displayPath = `${testFiles.length} files in ${targetPath}`;
  } else {
    const analysis = analyzeTestFile(absolute);
    const delegations = analysis.observations.filter(o => o.kind === 'TEST_HELPER_DELEGATION');
    const helperIndex =
      delegations.length > 0 ? buildTestHelperIndex(delegations, path.dirname(absolute), astConfig) : undefined;
    const result = interpretTestQuality(
      analysis.observations,
      astConfig,
      getDomainDir(analysis.subjectPath),
      analysis.subjectExists,
      helperIndex,
    );
    allAssessments = [...result.assessments];
    displayPath = path.relative(PROJECT_ROOT, absolute);
  }

  const finalResult: AssessmentResult<TestQualityAssessment> = { assessments: allAssessments };

  if (args.pretty) {
    process.stdout.write(formatPrettyOutput(finalResult, displayPath) + '\n');
  } else {
    output(finalResult, false);
  }
}

function findTestFiles(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      results.push(...findTestFiles(fullPath));
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.spec.ts') ||
        entry.name.endsWith('.spec.tsx') ||
        entry.name.endsWith('.test.ts') ||
        entry.name.endsWith('.test.tsx'))
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

function getDomainDir(subjectPath: string): string {
  if (!subjectPath) return '';

  const parts = subjectPath.split('/');
  const domainMarkers = ['dashboard', 'hooks'];

  for (const marker of domainMarkers) {
    const idx = parts.indexOf(marker);
    if (idx !== -1 && idx + 1 < parts.length) {
      return parts.slice(0, idx + 2).join('/');
    }
  }

  return path.dirname(subjectPath);
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-test-quality.ts') || process.argv[1].endsWith('ast-interpret-test-quality'));

if (isDirectRun) {
  main();
}
