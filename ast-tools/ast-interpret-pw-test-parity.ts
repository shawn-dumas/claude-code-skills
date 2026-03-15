/**
 * Interpreter for ast-pw-test-parity observations.
 *
 * Takes two sets of PwSpecInventory (source and target), matches tests
 * by multi-signal intent comparison, classifies parity status, and
 * produces a weighted parity score.
 *
 * Scoring criteria:
 *   - Each source test contributes its assertion count as weight
 *   - Tests with 0 assertions get a base weight of 1
 *   - Score = sum(matched_weight) / sum(total_weight) * 100
 *   - Matched weight is: full weight for PARITY/EXPANDED, half for REDUCED, 0 for NOT_PORTED
 *
 * NOTE: This interpreter returns a custom ParityReport instead of the
 * standard AssessmentResult<T> pattern used by other interpreters. The
 * parity comparison is cross-file (source vs. target suite) rather than
 * per-file, which does not map cleanly to the single-file assessment
 * model. A future refactor could wrap TestMatch entries as assessments
 * with confidence/rationale/basedOn fields.
 */

import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { astConfig } from './ast-config';
import {
  analyzeTestParityDirectory,
  analyzeTestParityBranch,
  buildHelperIndex,
  buildHelperIndexFromBranch,
} from './ast-pw-test-parity';
import type { PwSpecInventory, PwTestBlock, PwHelperIndex } from './types';

// ---------------------------------------------------------------------------
// File mapping (from ast-config.ts)
// ---------------------------------------------------------------------------

const DEFAULT_FILE_MAPPING = astConfig.testParity.fileMapping;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ParityStatus = 'PARITY' | 'REDUCED' | 'EXPANDED' | 'NOT_PORTED';

export type FileParityStatus = 'EXPANDED' | 'PARITY' | 'SHRUNK' | 'EMPTY' | 'NOT_MAPPED';

export interface TestMatch {
  sourceTest: string;
  sourceFile: string;
  targetTest: string | null;
  targetFile: string | null;
  status: ParityStatus;
  sourceAssertions: number;
  targetAssertions: number;
  sourceWeight: number;
  weightRatio: number | null;
  confidence: 'high' | 'low';
  similarity: number;
  matchSignals: string[];
  notes: string[];
  /** Target tests that share structural signals with this match (split detection) */
  splitCoverage: string[];
}

export interface FileMatch {
  sourceFile: string;
  targetFile: string | null;
  sourceTestCount: number;
  targetTestCount: number;
  status: FileParityStatus;
  /** 'none' when all source tests score 0.00 against all target tests */
  structuralSignal: 'present' | 'none';
  testMatches: TestMatch[];
}

export interface ParityScore {
  /** 0-100, weighted by assertion depth */
  overall: number;
  totalWeight: number;
  matchedWeight: number;
  byStatus: Record<ParityStatus, number>;
}

export interface ParityReport {
  fileMatches: FileMatch[];
  score: ParityScore;
  summary: {
    totalSourceTests: number;
    totalTargetTests: number;
    netNewTargetFiles: string[];
    droppedFiles: string[];
  };
}

// ---------------------------------------------------------------------------
// Intent-based test matching
// ---------------------------------------------------------------------------

function normalizeTestName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(
    normalizeTestName(a)
      .split(' ')
      .filter(w => w.length > 2),
  );
  const wordsB = new Set(
    normalizeTestName(b)
      .split(' ')
      .filter(w => w.length > 2),
  );

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}

function routeOverlap(a: PwTestBlock, b: PwTestBlock): number {
  if (a.routeIntercepts.length === 0 && b.routeIntercepts.length === 0) return 0;
  if (a.routeIntercepts.length === 0 || b.routeIntercepts.length === 0) return 0;

  const patternsA = new Set(a.routeIntercepts.map(r => r.urlPattern));
  const patternsB = new Set(b.routeIntercepts.map(r => r.urlPattern));

  let overlap = 0;
  for (const p of patternsA) {
    if (patternsB.has(p)) overlap++;
  }

  return overlap / Math.max(patternsA.size, patternsB.size);
}

function navigationOverlap(a: PwTestBlock, b: PwTestBlock): number {
  if (a.navigations.length === 0 && b.navigations.length === 0) return 0;
  if (a.navigations.length === 0 || b.navigations.length === 0) return 0;

  const navsA = new Set(a.navigations);
  const navsB = new Set(b.navigations);

  let overlap = 0;
  for (const n of navsA) {
    if (navsB.has(n)) overlap++;
  }

  return overlap / Math.max(navsA.size, navsB.size);
}

function pomOverlap(a: PwTestBlock, b: PwTestBlock): number {
  if (a.pomUsages.length === 0 && b.pomUsages.length === 0) return 0;
  if (a.pomUsages.length === 0 || b.pomUsages.length === 0) return 0;

  const pomsA = new Set(a.pomUsages);
  const pomsB = new Set(b.pomUsages);

  let overlap = 0;
  for (const p of pomsA) {
    if (pomsB.has(p)) overlap++;
  }

  return overlap / Math.max(pomsA.size, pomsB.size);
}

interface MatchCandidate {
  index: number;
  similarity: number;
  signals: string[];
}

/**
 * Multi-signal matching. Computes a composite similarity score from:
 *   - Test name word overlap (weight: 0.5)
 *   - Route intercept URL overlap (weight: 0.2)
 *   - Navigation URL overlap (weight: 0.15)
 *   - POM class overlap (weight: 0.15)
 */
function computeMatchScore(source: PwTestBlock, target: PwTestBlock): MatchCandidate | null {
  const nameScore = wordOverlap(source.name, target.name);
  const routeScore = routeOverlap(source, target);
  const navScore = navigationOverlap(source, target);
  const pomScore = pomOverlap(source, target);

  const signals: string[] = [];
  if (nameScore > 0.3) signals.push(`name:${nameScore.toFixed(2)}`);
  if (routeScore > 0) signals.push(`routes:${routeScore.toFixed(2)}`);
  if (navScore > 0) signals.push(`nav:${navScore.toFixed(2)}`);
  if (pomScore > 0) signals.push(`pom:${pomScore.toFixed(2)}`);

  const composite = nameScore * 0.5 + routeScore * 0.2 + navScore * 0.15 + pomScore * 0.15;

  if (composite < 0.15) return null;

  return { index: -1, similarity: composite, signals };
}

function findBestMatch(source: PwTestBlock, targets: PwTestBlock[], usedIndices: Set<number>): MatchCandidate | null {
  let best: MatchCandidate | null = null;

  for (let i = 0; i < targets.length; i++) {
    if (usedIndices.has(i)) continue;
    const candidate = computeMatchScore(source, targets[i]);
    if (!candidate) continue;
    candidate.index = i;
    if (!best || candidate.similarity > best.similarity) {
      best = candidate;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Parity classification
// ---------------------------------------------------------------------------

/**
 * Compute route-normalized weight ratio. When the target uses a mock
 * handler baseline (all endpoints served globally), individual tests
 * don't need explicit page.route() calls. Without normalization, the
 * source's route intercepts inflate its weight and deflate the ratio,
 * producing false REDUCED classifications.
 *
 * Normalization removes the route differential from the source weight
 * so that only the excess routes (routes the source has but the target
 * lacks) are excluded from the comparison. If both sides have routes,
 * they're compared fairly. If the target has more routes, no adjustment.
 */
function computeNormalizedWeightRatio(
  source: PwTestBlock,
  target: PwTestBlock,
  sourceHelpers?: PwHelperIndex,
  targetHelpers?: PwHelperIndex,
  mockHandlerBaseline?: boolean,
): number {
  const sourceWeight = computeTestWeight(source, sourceHelpers);
  const targetWeight = computeTestWeight(target, targetHelpers);

  if (!mockHandlerBaseline) return targetWeight / sourceWeight;

  const routeDiff = Math.max(0, source.routeIntercepts.length - target.routeIntercepts.length);
  const normalizedSourceWeight = Math.max(sourceWeight - routeDiff * 2, 1);
  return targetWeight / normalizedSourceWeight;
}

/**
 * Compute the total resolved assertion weight for a test, including both
 * explicit assertions in the test body and assertions inside POM/helper
 * methods that the test delegates to.
 *
 * NOTE: Only counts helpers with assertionCount > 0. POM methods that do
 * structural work without asserting (selectTab, clickUpdate) are excluded
 * because this function answers "does the target verify things?" not "does
 * the target do things?" The structural value of 0-assertion helpers is
 * captured separately in computeTestWeight via the flat-3 baseline.
 */
function computeResolvedAssertions(test: PwTestBlock, helperIndex?: PwHelperIndex): number {
  let total = test.assertionCount;

  if (!helperIndex) return total;

  for (const hd of test.helperDelegations) {
    const resolved = resolveHelperWeight(hd.functionName, helperIndex);
    if (resolved !== undefined && resolved > 0) {
      total += resolved;
    }
  }

  return total;
}

function classifyTestParity(
  source: PwTestBlock,
  target: PwTestBlock | null,
  sourceHelpers?: PwHelperIndex,
  targetHelpers?: PwHelperIndex,
  mockHandlerBaseline?: boolean,
): ParityStatus {
  if (!target) return 'NOT_PORTED';

  const weightRatio = computeNormalizedWeightRatio(source, target, sourceHelpers, targetHelpers, mockHandlerBaseline);

  // Weight ratio comparison:
  //   > 2.0  -> EXPANDED (target has at least double the coverage signals)
  //   < 0.4  -> REDUCED  (target lost more than 60% of coverage signals)
  //   else   -> PARITY
  // Wide band because structural differences (POM vs inline) inflate
  // target weight without adding actual coverage depth.
  if (weightRatio > 2.0) return 'EXPANDED';

  if (weightRatio < 0.4) {
    // Assertion equivalence floor: when the target's total resolved
    // assertions (explicit + POM-delegated) meet or exceed the source's
    // explicit assertion count, the test is verifying equivalent behavior
    // through POM methods. Don't classify as REDUCED based purely on
    // infrastructure weight differential (route intercepts, helper call
    // count, navigations).
    const targetResolved = computeResolvedAssertions(target, targetHelpers);
    if (source.assertionCount > 0 && targetResolved >= source.assertionCount) return 'PARITY';
    // Also: if source has 0 assertions but target has resolved assertions,
    // the target is strictly more thorough and should not be REDUCED.
    if (source.assertionCount === 0 && targetResolved > 0) return 'PARITY';

    return 'REDUCED';
  }

  // Even if weights are similar, check matcher quality degradation.
  const strongMatchers = new Set(['toHaveText', 'toContainText', 'toHaveValue', 'toHaveAttribute', 'toHaveCount']);
  const sourceStrong = source.assertions.filter(a => strongMatchers.has(a.matcher)).length;
  const targetStrong = target.assertions.filter(a => strongMatchers.has(a.matcher)).length;

  if (sourceStrong > 2 && targetStrong === 0 && target.assertionCount > 0) return 'REDUCED';

  return 'PARITY';
}

function computeWeightRatio(
  source: PwTestBlock,
  target: PwTestBlock | null,
  sourceHelpers?: PwHelperIndex,
  targetHelpers?: PwHelperIndex,
  mockHandlerBaseline?: boolean,
): number | null {
  if (!target) return null;
  return computeNormalizedWeightRatio(source, target, sourceHelpers, targetHelpers, mockHandlerBaseline);
}

/**
 * Confidence is 'low' when the weight ratio is within 20% of a threshold
 * boundary (0.4 for REDUCED, 2.0 for EXPANDED), meaning a small change
 * in either test could flip the classification.
 */
function computeConfidence(weightRatio: number | null, status: ParityStatus): 'high' | 'low' {
  if (status === 'NOT_PORTED') return 'high';
  if (weightRatio === null) return 'high';

  const REDUCED_BOUNDARY = 0.4;
  const EXPANDED_BOUNDARY = 2.0;
  const MARGIN = 0.2;

  const nearReduced = Math.abs(weightRatio - REDUCED_BOUNDARY) < REDUCED_BOUNDARY * MARGIN;
  const nearExpanded = Math.abs(weightRatio - EXPANDED_BOUNDARY) < EXPANDED_BOUNDARY * MARGIN;

  return nearReduced || nearExpanded ? 'low' : 'high';
}

function classifyFileStatus(sourceCount: number, targetCount: number): FileParityStatus {
  if (targetCount === 0) return 'EMPTY';
  if (targetCount > sourceCount) return 'EXPANDED';
  if (targetCount < sourceCount) return 'SHRUNK';
  return 'PARITY';
}

function buildNotes(source: PwTestBlock, target: PwTestBlock | null): string[] {
  const notes: string[] = [];

  if (!target) {
    notes.push('No matching test in target');
    return notes;
  }

  const assertionDelta = target.assertionCount - source.assertionCount;
  if (assertionDelta > 2) notes.push(`+${assertionDelta} assertions`);
  if (assertionDelta < -2) notes.push(`${assertionDelta} assertions`);
  if (target.assertionCount === 0 && source.assertionCount > 0) {
    notes.push(`Source had ${source.assertionCount} assertions, target has 0`);
  }

  if (target.pomUsages.length > 0 && source.pomUsages.length === 0) {
    notes.push('Target uses POMs');
  }

  const routeDelta = target.routeIntercepts.length - source.routeIntercepts.length;
  if (routeDelta !== 0) {
    notes.push(`Routes: ${source.routeIntercepts.length} -> ${target.routeIntercepts.length}`);
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Composite weight
// ---------------------------------------------------------------------------

/**
 * Resolve a helper delegation against the helper index.
 *
 * The observation layer records delegations using the variable name
 * (e.g., `insights.verifyExport`) but the helper index stores entries
 * by class name (e.g., `InsightsPage.verifyExport`). This function
 * tries three lookup strategies:
 *
 *   1. Exact match (`insights.verifyExport`)
 *   2. Method-name-only match (`verifyExport`) -- for standalone functions
 *   3. Fuzzy class match -- for `obj.method` delegations, search for any
 *      `ClassName.method` entry in the index
 *
 * Returns the resolved assertion count or undefined if no match found.
 */
function resolveHelperWeight(functionName: string, index: PwHelperIndex): number | undefined {
  // 1. Exact match
  const exact = index.lookup[functionName];
  if (exact !== undefined) return exact;

  const dotIdx = functionName.indexOf('.');
  if (dotIdx === -1) {
    // Standalone function -- no fallback beyond exact match
    return undefined;
  }

  const methodPart = functionName.slice(dotIdx + 1);

  // 2. Fuzzy class match: find any ClassName.methodPart entry
  const suffix = `.${methodPart}`;
  const candidates = index.entries.filter(e => e.qualifiedName.endsWith(suffix));
  if (candidates.length === 1) return candidates[0].assertionCount;

  return undefined;
}

function computeTestWeight(test: PwTestBlock, helperIndex?: PwHelperIndex): number {
  let helperWeight = 0;

  for (const hd of test.helperDelegations) {
    if (helperIndex) {
      const resolved = resolveHelperWeight(hd.functionName, helperIndex);
      if (resolved !== undefined) {
        // Use actual assertion count, but never below the flat-3 baseline.
        // POM methods with 0 assertions (selectTab, clickUpdate) still have
        // structural value -- the resolution should only increase weight
        // above the baseline when a method contains significant assertions
        // (e.g., verifyExport with 5, waitForFilters with 7).
        helperWeight += Math.max(resolved, 3);
        continue;
      }
    }
    // Fallback: flat weight of 3 per helper delegation
    helperWeight += 3;
  }

  const w =
    test.assertionCount +
    test.routeIntercepts.length * 2 +
    test.navigations.length +
    helperWeight +
    test.pomUsages.length;
  return Math.max(w, 1);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeScore(fileMatches: FileMatch[]): ParityScore {
  const byStatus: Record<ParityStatus, number> = {
    PARITY: 0,
    REDUCED: 0,
    EXPANDED: 0,
    NOT_PORTED: 0,
  };

  let totalWeight = 0;
  let matchedWeight = 0;

  for (const fm of fileMatches) {
    for (const tm of fm.testMatches) {
      const weight = tm.sourceWeight;
      totalWeight += weight;
      byStatus[tm.status]++;

      if (tm.status === 'PARITY' || tm.status === 'EXPANDED') {
        matchedWeight += weight;
      } else if (tm.status === 'REDUCED') {
        matchedWeight += weight * 0.5;
      }
      // NOT_PORTED: 0 weight
    }
  }

  const overall = totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : 0;

  return { overall, totalWeight, matchedWeight, byStatus };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function interpretTestParity(
  sourceInventories: PwSpecInventory[],
  targetInventories: PwSpecInventory[],
  fileMapping: Record<string, string> = DEFAULT_FILE_MAPPING,
  options: {
    sourceHelpers?: PwHelperIndex;
    targetHelpers?: PwHelperIndex;
    /** When true, normalize route intercept weight differential. Use when
     *  the target suite serves data via a global mock handler rather than
     *  explicit per-test page.route() intercepts. */
    mockHandlerBaseline?: boolean;
  } = {},
): ParityReport {
  const { sourceHelpers, targetHelpers, mockHandlerBaseline } = options;
  const targetByName = new Map<string, PwSpecInventory>();
  for (const inv of targetInventories) {
    const basename = path.basename(inv.filePath);
    targetByName.set(basename, inv);
  }

  const fileMatches: FileMatch[] = [];
  const mappedTargetFiles = new Set<string>();

  for (const source of sourceInventories) {
    const sourceBasename = path.basename(source.filePath);
    const targetFileName = fileMapping[sourceBasename];
    const target = targetFileName ? targetByName.get(targetFileName) : null;

    if (targetFileName) mappedTargetFiles.add(targetFileName);

    if (!target) {
      fileMatches.push({
        sourceFile: source.filePath,
        targetFile: targetFileName ?? null,
        sourceTestCount: source.tests.length,
        targetTestCount: 0,
        status: 'NOT_MAPPED',
        structuralSignal: 'none',
        testMatches: source.tests.map(t => ({
          sourceTest: t.name,
          sourceFile: source.filePath,
          targetTest: null,
          targetFile: null,
          status: 'NOT_PORTED' as ParityStatus,
          sourceAssertions: t.assertionCount,
          targetAssertions: 0,
          sourceWeight: computeTestWeight(t, sourceHelpers),
          weightRatio: null,
          confidence: 'high' as const,
          similarity: 0,
          matchSignals: [],
          notes: ['No matching file in target'],
          splitCoverage: [],
        })),
      });
      continue;
    }

    const usedTargetIndices = new Set<number>();
    const testMatches: TestMatch[] = [];

    for (const sourceTest of source.tests) {
      const match = findBestMatch(sourceTest, target.tests, usedTargetIndices);

      if (match) {
        usedTargetIndices.add(match.index);
        const targetTest = target.tests[match.index];
        const status = classifyTestParity(sourceTest, targetTest, sourceHelpers, targetHelpers, mockHandlerBaseline);
        const wr = computeWeightRatio(sourceTest, targetTest, sourceHelpers, targetHelpers, mockHandlerBaseline);

        testMatches.push({
          sourceTest: sourceTest.name,
          sourceFile: source.filePath,
          targetTest: targetTest.name,
          targetFile: target.filePath,
          status,
          sourceAssertions: sourceTest.assertionCount,
          targetAssertions: targetTest.assertionCount,
          sourceWeight: computeTestWeight(sourceTest, sourceHelpers),
          weightRatio: wr,
          confidence: computeConfidence(wr, status),
          similarity: match.similarity,
          matchSignals: match.signals,
          notes: buildNotes(sourceTest, targetTest),
          splitCoverage: [],
        });
      } else {
        testMatches.push({
          sourceTest: sourceTest.name,
          sourceFile: source.filePath,
          targetTest: null,
          targetFile: target.filePath,
          status: 'NOT_PORTED',
          sourceAssertions: sourceTest.assertionCount,
          targetAssertions: 0,
          sourceWeight: computeTestWeight(sourceTest, sourceHelpers),
          weightRatio: null,
          confidence: 'high',
          similarity: 0,
          matchSignals: [],
          notes: buildNotes(sourceTest, null),
          splitCoverage: [],
        });
      }
    }

    // DOING #2: Post-match split detection.
    // For each matched source test, check if unmatched target tests in the
    // same file share route intercept or navigation patterns. If so,
    // annotate with splitCoverage (the names of the related target tests).
    const unmatchedTargetTests = target.tests.filter((_, i) => !usedTargetIndices.has(i));

    for (const tm of testMatches) {
      if (tm.status === 'NOT_PORTED' || !tm.targetTest) continue;

      // Find the source test block to get its route/nav signals
      const sourceTest = source.tests.find(t => t.name === tm.sourceTest);
      if (!sourceTest) continue;

      const sourceRoutes = new Set(sourceTest.routeIntercepts.map(r => r.urlPattern));
      const sourceNavs = new Set(sourceTest.navigations);
      if (sourceRoutes.size === 0 && sourceNavs.size === 0) continue;

      for (const ut of unmatchedTargetTests) {
        const sharedRoutes = ut.routeIntercepts.some(r => sourceRoutes.has(r.urlPattern));
        const sharedNavs = ut.navigations.some(n => sourceNavs.has(n));
        if (sharedRoutes || sharedNavs) {
          tm.splitCoverage.push(ut.name);
        }
      }
    }

    // DOING #3: Detect zero-signal file matches.
    // If every source test scored 0.00 similarity against every target test
    // (all NOT_PORTED with sim=0), there is no structural signal.
    const hasAnySignal = testMatches.some(tm => tm.similarity > 0);

    fileMatches.push({
      sourceFile: source.filePath,
      targetFile: target.filePath,
      sourceTestCount: source.tests.length,
      targetTestCount: target.tests.length,
      // Override file status when there's no structural signal --
      // equal test counts with zero matches is not real PARITY.
      status: hasAnySignal
        ? classifyFileStatus(source.tests.length, target.tests.length)
        : classifyFileStatus(source.tests.length, target.tests.length) === 'PARITY'
          ? 'SHRUNK' // demote PARITY to SHRUNK when no structural signal
          : classifyFileStatus(source.tests.length, target.tests.length),
      structuralSignal: hasAnySignal ? 'present' : 'none',
      testMatches,
    });
  }

  const netNewTargetFiles = targetInventories
    .map(t => path.basename(t.filePath))
    .filter(f => !mappedTargetFiles.has(f));

  const score = computeScore(fileMatches);

  return {
    fileMatches,
    score,
    summary: {
      totalSourceTests: sourceInventories.reduce((sum, s) => sum + s.tests.length, 0),
      totalTargetTests: targetInventories.reduce((sum, t) => sum + t.tests.length, 0),
      netNewTargetFiles,
      droppedFiles: fileMatches
        .filter(fm => fm.status === 'EMPTY' || fm.status === 'NOT_MAPPED')
        .map(fm => fm.sourceFile),
    },
  };
}

// ---------------------------------------------------------------------------
// Pretty-print
// ---------------------------------------------------------------------------

function padRight(str: string, len: number): string {
  return str.length >= len ? str + ' ' : str + ' '.repeat(len - str.length);
}

function prettyPrint(report: ParityReport): string {
  const lines: string[] = [];

  lines.push('=== PARITY SCORE ===\n');
  lines.push(`Overall:  ${report.score.overall}%`);
  lines.push(`Weight:   ${report.score.matchedWeight.toFixed(1)} / ${report.score.totalWeight.toFixed(1)}`);
  lines.push(`PARITY:   ${report.score.byStatus.PARITY}`);
  lines.push(`EXPANDED: ${report.score.byStatus.EXPANDED}`);
  lines.push(`REDUCED:  ${report.score.byStatus.REDUCED}`);
  lines.push(`NOT_PORTED: ${report.score.byStatus.NOT_PORTED}`);

  lines.push('\n=== FILE PARITY ===\n');
  lines.push(
    padRight('Source', 35) +
      padRight('Target', 30) +
      padRight('Src#', 5) +
      padRight('Tgt#', 5) +
      padRight('Signal', 8) +
      'Status',
  );
  lines.push('-'.repeat(98));

  for (const fm of report.fileMatches) {
    lines.push(
      padRight(fm.sourceFile, 35) +
        padRight(fm.targetFile ?? '(none)', 30) +
        padRight(String(fm.sourceTestCount), 5) +
        padRight(String(fm.targetTestCount), 5) +
        padRight(fm.structuralSignal, 8) +
        fm.status,
    );
  }

  lines.push('\n=== TEST MATCHES ===\n');
  lines.push(
    padRight('Source Test', 48) +
      padRight('Status', 12) +
      padRight('Conf', 5) +
      padRight('Sim', 6) +
      padRight('Wt', 5) +
      padRight('WR', 6) +
      'Signals / Notes',
  );
  lines.push('-'.repeat(120));

  for (const fm of report.fileMatches) {
    if (fm.testMatches.length === 0) continue;
    const signalTag = fm.structuralSignal === 'none' ? ' [NO STRUCTURAL SIGNAL]' : '';
    lines.push(`\n-- ${fm.sourceFile} -> ${fm.targetFile ?? '(none)'}${signalTag} --`);

    for (const tm of fm.testMatches) {
      const name = tm.sourceTest.length > 46 ? tm.sourceTest.substring(0, 43) + '...' : tm.sourceTest;
      const signalStr = tm.matchSignals.length > 0 ? tm.matchSignals.join(' ') : '';
      const noteStr = tm.notes.length > 0 ? tm.notes[0] : '';
      const splitStr = tm.splitCoverage.length > 0 ? `[split:${tm.splitCoverage.length}]` : '';
      const detail = [signalStr, noteStr, splitStr].filter(Boolean).join(' | ');
      const confMark = tm.confidence === 'low' ? '~' : ' ';
      const wrStr = tm.weightRatio !== null ? tm.weightRatio.toFixed(2) : '-';

      lines.push(
        padRight(name, 48) +
          padRight(tm.status + confMark, 12) +
          padRight(tm.confidence, 5) +
          padRight(tm.similarity.toFixed(2), 6) +
          padRight(String(tm.sourceWeight), 5) +
          padRight(wrStr, 6) +
          detail,
      );
    }
  }

  lines.push('\n=== SUMMARY ===\n');
  lines.push(`Source tests:       ${report.summary.totalSourceTests}`);
  lines.push(`Target tests:       ${report.summary.totalTargetTests}`);
  lines.push(
    `Net-new files:      ${report.summary.netNewTargetFiles.length} (${report.summary.netNewTargetFiles.join(', ')})`,
  );
  lines.push(`Dropped files:      ${report.summary.droppedFiles.length} (${report.summary.droppedFiles.join(', ')})`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const NAMED_OPTIONS = ['--source-branch', '--source-dir', '--target-dir'] as const;

function main(): void {
  const args = parseArgs(process.argv, NAMED_OPTIONS);
  const sourceBranch = args.options['source-branch'] ?? null;
  const sourceDir = args.options['source-dir'] ?? null;
  const targetDir = args.options['target-dir'] ?? null;

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-pw-test-parity.ts \\\n' +
        '  --source-branch <branch> --source-dir <dir> \\\n' +
        '  --target-dir <dir> [--pretty]\n' +
        '\n' +
        'Compare two Playwright test suites and produce a parity report with score.\n' +
        '\n' +
        '  --source-branch  Git branch for source specs\n' +
        '  --source-dir     Directory on the source branch\n' +
        '  --target-dir     Filesystem directory for target specs\n' +
        '  --pretty         Human-readable table output instead of JSON\n',
    );
    process.exit(0);
  }

  if (!sourceDir) fatal('--source-dir is required');
  if (!targetDir) fatal('--target-dir is required');

  let sourceInventories: PwSpecInventory[];
  if (sourceBranch) {
    sourceInventories = analyzeTestParityBranch(sourceBranch, sourceDir);
  } else {
    sourceInventories = analyzeTestParityDirectory(sourceDir);
  }

  const targetInventories = analyzeTestParityDirectory(targetDir);

  // Build helper indices from sibling directories (configured in ast-config)
  const helperDirNames = astConfig.testParity.helperDirs;

  const targetBase = path.dirname(path.resolve(PROJECT_ROOT, targetDir));
  const targetHelperDirs = helperDirNames.map(d => path.join(targetBase, d)).filter(d => fs.existsSync(d));
  const targetHelpers = targetHelperDirs.length > 0 ? buildHelperIndex(targetHelperDirs) : undefined;

  let sourceHelpers: PwHelperIndex | undefined;
  if (sourceBranch) {
    const sourceBase = sourceDir.replace(/tests\/?$/, '');
    const sourceHelperDirs = helperDirNames.map(d => `${sourceBase}${d}/`);
    sourceHelpers = buildHelperIndexFromBranch(sourceBranch, sourceHelperDirs);
    if (sourceHelpers.entries.length === 0) sourceHelpers = undefined;
  } else {
    const sourceBase = path.dirname(path.resolve(PROJECT_ROOT, sourceDir));
    const sourceHelperDirsLocal = helperDirNames.map(d => path.join(sourceBase, d)).filter(d => fs.existsSync(d));
    sourceHelpers = sourceHelperDirsLocal.length > 0 ? buildHelperIndex(sourceHelperDirsLocal) : undefined;
  }

  // Detect mock handler baseline: integration tests use a global mock API
  // handler and don't need explicit page.route() calls per test.
  const mockHandlerBaseline = targetDir.includes(astConfig.testParity.mockHandlerBaselineMarker);

  const report = interpretTestParity(sourceInventories, targetInventories, DEFAULT_FILE_MAPPING, {
    sourceHelpers,
    targetHelpers,
    mockHandlerBaseline,
  });

  if (args.pretty) {
    process.stdout.write(prettyPrint(report) + '\n');
  } else {
    output(report, false);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-pw-test-parity.ts') ||
    process.argv[1].endsWith('ast-interpret-pw-test-parity'));

if (isDirectRun) {
  main();
}
