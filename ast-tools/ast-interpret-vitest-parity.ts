/**
 * Interpreter for ast-vitest-parity observations.
 *
 * Takes two sets of VtSpecInventory (source and target), matches tests
 * by multi-signal comparison (name, assertions, mocks), classifies
 * parity status, and produces a weighted parity score.
 *
 * Scoring:
 *   - Each source test contributes max(assertionCount, 1) as weight
 *   - PARITY and EXPANDED contribute full weight
 *   - REDUCED contributes targetAssertions / sourceAssertions * weight
 *   - NOT_PORTED contributes 0
 *   - Score = sum(matched_weight) / sum(total_weight) * 100
 */

import { parseArgs, output, fatal } from './cli';
import { analyzeVitestParityDirectory, analyzeVitestParityBranch } from './ast-vitest-parity';
import type {
  VtSpecInventory,
  VtTestBlock,
  VtAssertion,
  VtMockDeclaration,
  VtParityStatus,
  VtTestMatch,
  VtParityScore,
  VtParityReport,
} from './types';

// ---------------------------------------------------------------------------
// Name normalization and matching
// ---------------------------------------------------------------------------

function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(name: string): Set<string> {
  return new Set(
    normalizeTestName(name)
      .split(' ')
      .filter(w => w.length > 2),
  );
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let overlap = 0;
  for (const w of tokensA) {
    if (tokensB.has(w)) overlap++;
  }

  return overlap / Math.max(tokensA.size, tokensB.size);
}

/**
 * Strip leading describe context from a test name.
 * Vitest test names sometimes include the describe block prefix
 * separated by ' > '.
 */
function stripDescribePrefix(name: string): string {
  const parts = name.split(' > ');
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Assertion target overlap
// ---------------------------------------------------------------------------

function assertionTargetOverlap(
  sourceAssertions: readonly VtAssertion[],
  targetAssertions: readonly VtAssertion[],
): number {
  if (sourceAssertions.length === 0 || targetAssertions.length === 0) return 0;

  const sourceTargets = new Set(sourceAssertions.map(a => a.target).filter(Boolean));
  const targetTargets = new Set(targetAssertions.map(a => a.target).filter(Boolean));

  if (sourceTargets.size === 0 || targetTargets.size === 0) return 0;

  let overlap = 0;
  for (const t of sourceTargets) {
    if (targetTargets.has(t)) overlap++;
  }

  return overlap / Math.max(sourceTargets.size, targetTargets.size);
}

// ---------------------------------------------------------------------------
// Mock target overlap
// ---------------------------------------------------------------------------

function mockTargetOverlap(
  sourceMocks: readonly VtMockDeclaration[],
  targetMocks: readonly VtMockDeclaration[],
): number {
  // Filter to vi.mock only (module-level mocks are the strongest signal)
  const sourceTargets = new Set(sourceMocks.filter(m => m.mockType === 'vi.mock').map(m => m.mockTarget));
  const targetTargets = new Set(targetMocks.filter(m => m.mockType === 'vi.mock').map(m => m.mockTarget));

  if (sourceTargets.size === 0 || targetTargets.size === 0) return 0;

  let overlap = 0;
  for (const t of sourceTargets) {
    if (targetTargets.has(t)) overlap++;
  }

  return overlap / Math.max(sourceTargets.size, targetTargets.size);
}

// ---------------------------------------------------------------------------
// Multi-signal matching
// ---------------------------------------------------------------------------

interface MatchCandidate {
  index: number;
  similarity: number;
  confidence: 'high' | 'low';
}

/**
 * Find assertions belonging to a specific test within an inventory's
 * assertion list.
 */
function getTestAssertions(testName: string, allAssertions: readonly VtAssertion[]): VtAssertion[] {
  return allAssertions.filter(a => a.parentTest === testName);
}

/**
 * Find mocks belonging to the same describe scope as a test.
 * File-level mocks (parentDescribe === null) apply to all tests.
 */
function getTestMocks(test: VtTestBlock, allMocks: readonly VtMockDeclaration[]): VtMockDeclaration[] {
  return allMocks.filter(m => m.parentDescribe === null || m.parentDescribe === test.parentDescribe);
}

function computeMatchScore(
  sourceTest: VtTestBlock,
  targetTest: VtTestBlock,
  sourceAssertions: readonly VtAssertion[],
  targetAssertions: readonly VtAssertion[],
  sourceMocks: readonly VtMockDeclaration[],
  targetMocks: readonly VtMockDeclaration[],
): MatchCandidate | null {
  const sourceNameStripped = stripDescribePrefix(sourceTest.name);
  const targetNameStripped = stripDescribePrefix(targetTest.name);

  // Exact name match (ignoring describe prefix)
  const normalizedSource = normalizeTestName(sourceNameStripped);
  const normalizedTarget = normalizeTestName(targetNameStripped);

  if (normalizedSource === normalizedTarget && normalizedSource.length > 0) {
    return { index: -1, similarity: 1.0, confidence: 'high' };
  }

  // Fuzzy name match
  const nameScore = tokenOverlap(sourceNameStripped, targetNameStripped);

  // Assertion target overlap
  const sAssertions = getTestAssertions(sourceTest.name, sourceAssertions);
  const tAssertions = getTestAssertions(targetTest.name, targetAssertions);
  const assertionScore = assertionTargetOverlap(sAssertions, tAssertions);

  // Mock target overlap
  const sMocks = getTestMocks(sourceTest, sourceMocks);
  const tMocks = getTestMocks(targetTest, targetMocks);
  const mockScore = mockTargetOverlap(sMocks, tMocks);

  // Describe-context bonus: tests in the same describe block are more likely
  // to be related. No penalty for different describes -- structural
  // reorganization (flat -> nested) is common in refactors and not a
  // negative signal.
  const describeBonus =
    sourceTest.parentDescribe && targetTest.parentDescribe && sourceTest.parentDescribe === targetTest.parentDescribe
      ? 0.05
      : 0;

  // Composite: name has highest weight
  const composite = Math.min(nameScore * 0.6 + assertionScore * 0.25 + mockScore * 0.15 + describeBonus, 1.0);

  if (composite < 0.15) return null;

  const confidence: 'high' | 'low' = nameScore > 0.8 ? 'high' : 'low';

  return { index: -1, similarity: composite, confidence };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function classifyTestParity(sourceAssertions: number, targetAssertions: number): VtParityStatus {
  if (sourceAssertions === 0) {
    // Source has no assertions; any target assertions make it EXPANDED
    return targetAssertions > 0 ? 'EXPANDED' : 'PARITY';
  }

  const ratio = targetAssertions / sourceAssertions;

  if (ratio > 1.2) return 'EXPANDED';
  if (ratio < 0.8) return 'REDUCED';
  return 'PARITY';
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeTestWeight(assertionCount: number): number {
  return Math.max(assertionCount, 1);
}

function computeScore(matches: readonly VtTestMatch[], novelCount: number): VtParityScore {
  let total = 0;
  let matched = 0;
  let parity = 0;
  let reduced = 0;
  let expanded = 0;
  let notPorted = 0;

  for (const m of matches) {
    const weight = computeTestWeight(m.sourceAssertions);
    total += weight;

    switch (m.status) {
      case 'PARITY':
        matched += weight;
        parity++;
        break;
      case 'EXPANDED':
        matched += weight;
        expanded++;
        break;
      case 'REDUCED': {
        const contributedWeight = m.sourceAssertions > 0 ? (m.targetAssertions / m.sourceAssertions) * weight : weight;
        matched += contributedWeight;
        reduced++;
        break;
      }
      case 'NOT_PORTED':
        notPorted++;
        break;
    }
  }

  const score = total > 0 ? Math.round((matched / total) * 1000) / 10 : 0;

  return {
    total,
    matched: Math.round(matched * 10) / 10,
    parity,
    reduced,
    expanded,
    notPorted,
    novel: novelCount,
    score,
  };
}

// ---------------------------------------------------------------------------
// File mapping
// ---------------------------------------------------------------------------

/**
 * Build a map from source file basename to matching target inventory.
 * For same-file comparison (cross-branch), source and target share the
 * same relative path.
 */
function buildFileMap(
  sourceInventories: readonly VtSpecInventory[],
  targetInventories: readonly VtSpecInventory[],
): Map<string, VtSpecInventory> {
  const targetByFile = new Map<string, VtSpecInventory>();
  for (const inv of targetInventories) {
    targetByFile.set(inv.file, inv);
  }
  return targetByFile;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function interpretVitestParity(
  sourceInventories: VtSpecInventory[],
  targetInventories: VtSpecInventory[],
): VtParityReport {
  const targetByFile = buildFileMap(sourceInventories, targetInventories);
  const matchedTargetFiles = new Set<string>();
  const allMatches: VtTestMatch[] = [];

  for (const source of sourceInventories) {
    const target = targetByFile.get(source.file);

    if (!target) {
      // All source tests are NOT_PORTED
      for (const test of source.tests) {
        const mocks = getTestMocks(test, source.mocks).map(m => m.mockTarget);
        allMatches.push({
          sourceTest: test.name,
          sourceFile: source.file,
          targetTest: null,
          targetFile: null,
          status: 'NOT_PORTED',
          sourceAssertions: test.assertionCount,
          targetAssertions: 0,
          sourceMocks: mocks,
          targetMocks: [],
          confidence: 'high',
          similarity: 0,
        });
      }
      continue;
    }

    matchedTargetFiles.add(target.file);
    const usedTargetIndices = new Set<number>();
    const matchedSourceIndices = new Set<number>();
    const sourceMatchResults = new Map<number, { match: MatchCandidate; targetTest: VtTestBlock }>();

    // Pass 1: exact name matches (sim === 1.0). These must be locked in
    // before fuzzy matching to prevent a fuzzy match from stealing an
    // exact match's target.
    for (let si = 0; si < source.tests.length; si++) {
      const sourceTest = source.tests[si];
      const normalizedSource = normalizeTestName(stripDescribePrefix(sourceTest.name));
      if (normalizedSource.length === 0) continue;

      for (let ti = 0; ti < target.tests.length; ti++) {
        if (usedTargetIndices.has(ti)) continue;
        const normalizedTarget = normalizeTestName(stripDescribePrefix(target.tests[ti].name));
        if (normalizedSource === normalizedTarget) {
          usedTargetIndices.add(ti);
          matchedSourceIndices.add(si);
          sourceMatchResults.set(si, {
            match: { index: ti, similarity: 1.0, confidence: 'high' },
            targetTest: target.tests[ti],
          });
          break;
        }
      }
    }

    // Pass 2: fuzzy + structural matches for remaining unmatched source tests.
    // Compute ALL candidate pairs, sort by similarity descending, then
    // greedily assign from highest to lowest. This prevents a low-quality
    // match from stealing a target that a higher-quality source needs.
    const candidates: { si: number; ti: number; match: MatchCandidate }[] = [];
    for (let si = 0; si < source.tests.length; si++) {
      if (matchedSourceIndices.has(si)) continue;
      const sourceTest = source.tests[si];
      for (let ti = 0; ti < target.tests.length; ti++) {
        if (usedTargetIndices.has(ti)) continue;
        const candidate = computeMatchScore(
          sourceTest,
          target.tests[ti],
          source.assertions,
          target.assertions,
          source.mocks,
          target.mocks,
        );
        if (candidate) {
          candidates.push({ si, ti, match: { ...candidate, index: ti } });
        }
      }
    }

    // Sort descending by similarity so the strongest matches are assigned first
    candidates.sort((a, b) => b.match.similarity - a.match.similarity);

    for (const { si, ti, match } of candidates) {
      if (matchedSourceIndices.has(si) || usedTargetIndices.has(ti)) continue;
      usedTargetIndices.add(ti);
      matchedSourceIndices.add(si);
      sourceMatchResults.set(si, {
        match,
        targetTest: target.tests[ti],
      });
    }

    // Emit results for all source tests in order
    for (let si = 0; si < source.tests.length; si++) {
      const sourceTest = source.tests[si];
      const sMocks = getTestMocks(sourceTest, source.mocks).map(m => m.mockTarget);
      const result = sourceMatchResults.get(si);

      if (result) {
        const { match, targetTest: tTest } = result;
        const status = classifyTestParity(sourceTest.assertionCount, tTest.assertionCount);
        const tMocks = getTestMocks(tTest, target.mocks).map(m => m.mockTarget);

        allMatches.push({
          sourceTest: sourceTest.name,
          sourceFile: source.file,
          targetTest: tTest.name,
          targetFile: target.file,
          status,
          sourceAssertions: sourceTest.assertionCount,
          targetAssertions: tTest.assertionCount,
          sourceMocks: sMocks,
          targetMocks: tMocks,
          confidence: match.confidence,
          similarity: match.similarity,
        });
      } else {
        allMatches.push({
          sourceTest: sourceTest.name,
          sourceFile: source.file,
          targetTest: null,
          targetFile: null,
          status: 'NOT_PORTED',
          sourceAssertions: sourceTest.assertionCount,
          targetAssertions: 0,
          sourceMocks: sMocks,
          targetMocks: [],
          confidence: 'high',
          similarity: 0,
        });
      }
    }
  }

  // Count NOVEL tests (target tests with no source match)
  let novelCount = 0;
  for (const target of targetInventories) {
    if (!matchedTargetFiles.has(target.file)) {
      novelCount += target.tests.length;
      continue;
    }
    // For matched files, count target tests that were not matched
    const source = sourceInventories.find(s => s.file === target.file);
    if (!source) {
      novelCount += target.tests.length;
      continue;
    }
    const matchedTargetTests = new Set(
      allMatches.filter(m => m.targetFile === target.file && m.targetTest !== null).map(m => m.targetTest),
    );
    for (const test of target.tests) {
      if (!matchedTargetTests.has(test.name)) {
        novelCount++;
      }
    }
  }

  const score = computeScore(allMatches, novelCount);

  return {
    matches: allMatches,
    score,
    sourceFiles: sourceInventories.map(s => s.file),
    targetFiles: targetInventories.map(t => t.file),
  };
}

// ---------------------------------------------------------------------------
// Pretty-print
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  return str.length >= len ? str + ' ' : str + ' '.repeat(len - str.length);
}

export function prettyPrint(report: VtParityReport, sourceLabel: string, targetLabel: string): string {
  const lines: string[] = [];

  lines.push('Test Parity Report (Vitest)');
  lines.push('==========================\n');

  lines.push(`Source: ${sourceLabel}`);
  lines.push(`Target: ${targetLabel}\n`);

  const { score } = report;
  lines.push(`Score: ${score.score} (${score.matched}/${score.total} weighted assertions)\n`);

  // Group matches by status
  const parityMatches = report.matches.filter(m => m.status === 'PARITY');
  const expandedMatches = report.matches.filter(m => m.status === 'EXPANDED');
  const reducedMatches = report.matches.filter(m => m.status === 'REDUCED');
  const notPortedMatches = report.matches.filter(m => m.status === 'NOT_PORTED');

  if (parityMatches.length > 0) {
    lines.push(`PARITY (${parityMatches.length}):`);
    for (const m of parityMatches) {
      const name = m.sourceTest.length > 50 ? m.sourceTest.substring(0, 47) + '...' : m.sourceTest;
      lines.push(`  [${m.confidence}] ${padRight(JSON.stringify(name), 55)}${m.sourceAssertions} assertions`);
    }
    lines.push('');
  }

  if (expandedMatches.length > 0) {
    lines.push(`EXPANDED (${expandedMatches.length}):`);
    for (const m of expandedMatches) {
      const name = m.sourceTest.length > 50 ? m.sourceTest.substring(0, 47) + '...' : m.sourceTest;
      lines.push(
        `  [${m.confidence}] ${padRight(JSON.stringify(name), 55)}${m.sourceAssertions} -> ${m.targetAssertions} assertions`,
      );
    }
    lines.push('');
  }

  if (reducedMatches.length > 0) {
    lines.push(`REDUCED (${reducedMatches.length}):`);
    for (const m of reducedMatches) {
      const name = m.sourceTest.length > 50 ? m.sourceTest.substring(0, 47) + '...' : m.sourceTest;
      lines.push(
        `  [${m.confidence}] ${padRight(JSON.stringify(name), 55)}${m.sourceAssertions} -> ${m.targetAssertions} assertions`,
      );
    }
    lines.push('');
  }

  if (notPortedMatches.length > 0) {
    lines.push(`NOT_PORTED (${notPortedMatches.length}):`);
    for (const m of notPortedMatches) {
      const name = m.sourceTest.length > 50 ? m.sourceTest.substring(0, 47) + '...' : m.sourceTest;
      lines.push(`  ${padRight(JSON.stringify(name), 59)}${m.sourceAssertions} assertions (lost)`);
    }
    lines.push('');
  }

  if (score.novel > 0) {
    lines.push(`NOVEL: ${score.novel} target-only tests (not in score calculation)\n`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const NAMED_OPTIONS = ['--source-branch', '--source-dir', '--target-dir'] as const;

export function main(): void {
  const args = parseArgs(process.argv, NAMED_OPTIONS);
  const sourceBranch = args.options['source-branch'] ?? null;
  const sourceDir = args.options['source-dir'] ?? null;
  const targetDir = args.options['target-dir'] ?? null;

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-vitest-parity.ts \\\n' +
        '  --source-branch <branch> --source-dir <dir> \\\n' +
        '  --target-dir <dir> [--pretty]\n' +
        '\n' +
        'Also supports same-branch local comparison:\n' +
        '  npx tsx scripts/AST/ast-interpret-vitest-parity.ts \\\n' +
        '    --source-dir <dir-a> --target-dir <dir-b> [--pretty]\n' +
        '\n' +
        'Compare two Vitest test suites and produce a parity report with score.\n' +
        '\n' +
        '  --source-branch  Git branch for source specs\n' +
        '  --source-dir     Directory of source specs\n' +
        '  --target-dir     Directory of target specs\n' +
        '  --pretty         Human-readable output instead of JSON\n',
    );
    process.exit(0);
  }

  if (!sourceDir) fatal('--source-dir is required');
  if (!targetDir) fatal('--target-dir is required');

  let sourceInventories: VtSpecInventory[];
  if (sourceBranch) {
    sourceInventories = analyzeVitestParityBranch(sourceBranch, sourceDir);
  } else {
    sourceInventories = analyzeVitestParityDirectory(sourceDir);
  }

  const targetInventories = analyzeVitestParityDirectory(targetDir);

  const report = interpretVitestParity(sourceInventories, targetInventories);

  if (args.pretty) {
    const sourceLabel = sourceBranch ? `${sourceBranch}:${sourceDir}` : sourceDir;
    process.stdout.write(prettyPrint(report, sourceLabel, targetDir) + '\n');
  } else {
    output(report, false);
  }
}

/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-vitest-parity.ts') ||
    process.argv[1].endsWith('ast-interpret-vitest-parity'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
