/**
 * Regression test for interpreter accuracy.
 *
 * Covers two fixture formats:
 * - **Pair-based** (intent, parity, vitest-parity): before/after or
 *   source/target file pairs.
 * - **Entry-based** (effects, hooks, ownership, template, test-quality,
 *   dead-code): single-file classification against ground-truth labels.
 *
 * Loads all fixtures from ground-truth/fixtures/, groups by tool,
 * runs each interpreter on its fixtures, and asserts accuracy >= threshold
 * per tool. This is the same test the /calibrate-ast-interpreter skill
 * runs in its Step 8. It exists as a vitest spec so CI catches accuracy
 * regressions from code changes to the interpreters or observation tools.
 */

import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runAllObservers } from '../tool-registry';
import { createVirtualProject } from '../git-source';
import { astConfig } from '../ast-config';
import { interpretRefactorIntent } from '../ast-interpret-refactor-intent';
import { matchSignals } from '../ast-refactor-intent';
import { interpretTestParity } from '../ast-interpret-pw-test-parity';
import { analyzeTestParity, analyzeHelperFile } from '../ast-pw-test-parity';
import { analyzeVitestParity } from '../ast-vitest-parity';
import { interpretVitestParity } from '../ast-interpret-vitest-parity';
import { analyzeReactFile } from '../ast-react-inventory';
import { interpretEffects } from '../ast-interpret-effects';
import { interpretHooks } from '../ast-interpret-hooks';
import { interpretOwnership, type OwnershipInputs } from '../ast-interpret-ownership';
import { extractJsxObservations } from '../ast-jsx-analysis';
import { interpretTemplate } from '../ast-interpret-template';
import { analyzeTestFile } from '../ast-test-analysis';
import { interpretTestQuality } from '../ast-interpret-test-quality';
import { buildDependencyGraph, extractImportObservations } from '../ast-imports';
import { interpretDeadCode } from '../ast-interpret-dead-code';
import type {
  AnyObservation,
  Assessment,
  RefactorSignalPair,
  AuditContext,
  PwSpecInventory,
  PwHelperIndex,
  VtSpecInventory,
} from '../types';

// ---------------------------------------------------------------------------
// Manifest types
// ---------------------------------------------------------------------------

interface IntentExpectedClassification {
  kind: string;
  evidence: Record<string, unknown>;
  expectedClassification: string;
  notes: string;
}

interface ParityExpectedClassification {
  testName: string;
  expectedStatus: string;
  notes: string;
}

interface IntentManifest {
  tool: 'intent';
  created: string;
  source: string;
  refactorType: string;
  beforeFiles: string[];
  afterFiles: string[];
  expectedClassifications: IntentExpectedClassification[];
  status: string;
}

interface ParityManifest {
  tool: 'parity';
  created: string;
  source: string;
  sourceFiles: string[];
  targetFiles: string[];
  helperFiles: string[];
  expectedClassifications: ParityExpectedClassification[];
  status: string;
}

interface VitestParityManifest {
  tool: 'vitest-parity';
  created: string;
  source: string;
  sourceFiles: string[];
  targetFiles: string[];
  expectedClassifications: ParityExpectedClassification[];
  status: string;
}

type EntryTool = 'effects' | 'hooks' | 'ownership' | 'template' | 'test-quality' | 'dead-code';

interface EntryExpectedClassification {
  file: string;
  line: number;
  symbol: string;
  expectedKind: string;
  notes?: string;
}

interface EntryManifest {
  tool: EntryTool;
  created: string;
  source: string;
  files: string[];
  expectedClassifications: EntryExpectedClassification[];
  status: string;
}

type Manifest = IntentManifest | ParityManifest | VitestParityManifest | EntryManifest;

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ast-accuracy-${prefix}-`));
  tmpDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, '../ground-truth/fixtures');

function discoverFixtures(): Array<{ dir: string; manifest: Manifest }> {
  if (!fs.existsSync(FIXTURES_DIR)) return [];

  const dirs = fs.readdirSync(FIXTURES_DIR).filter(d => {
    const manifestPath = path.join(FIXTURES_DIR, d, 'manifest.json');
    return fs.existsSync(manifestPath);
  });

  return dirs.map(d => {
    const manifestPath = path.join(FIXTURES_DIR, d, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Manifest;
    return { dir: d, manifest };
  });
}

// ---------------------------------------------------------------------------
// Intent fixture evaluation
// ---------------------------------------------------------------------------

/**
 * Collect observations by writing content to a temp file and running all
 * observers. This works around the fact that several tool adapters require
 * real files on disk (complexity, data-layer, imports, etc.).
 */
function collectObservationsFromContent(content: string, fileName: string, tmpDir: string): AnyObservation[] {
  const tmpFile = path.join(tmpDir, fileName);
  fs.writeFileSync(tmpFile, content);

  const project = createVirtualProject();
  const sf = project.addSourceFileAtPath(tmpFile);

  const ignoredKinds = astConfig.intentMatcher.ignoredKinds;
  const observations = runAllObservers(sf, tmpFile);
  return observations.filter(o => !ignoredKinds.has(o.kind));
}

function evaluateIntentFixture(
  fixtureDir: string,
  manifest: IntentManifest,
): { correct: number; total: number; details: string[] } {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const tmpDir = createTempDir(fixtureDir);

  // Collect before observations
  const beforeObs: AnyObservation[] = [];
  const beforeFiles: string[] = [];
  for (const f of manifest.beforeFiles) {
    const content = fs.readFileSync(path.join(basePath, f), 'utf-8');
    const observations = collectObservationsFromContent(content, f, tmpDir);
    beforeObs.push(...observations);
    beforeFiles.push(f);
  }

  // Collect after observations
  const afterObs: AnyObservation[] = [];
  const afterFiles: string[] = [];
  for (const f of manifest.afterFiles) {
    const content = fs.readFileSync(path.join(basePath, f), 'utf-8');
    const observations = collectObservationsFromContent(content, f, tmpDir);
    afterObs.push(...observations);
    afterFiles.push(f);
  }

  // Use the real matchSignals from ast-refactor-intent (same algorithm used in production)
  const matchMinimum = astConfig.intentMatcher.thresholds.fail;
  const { matched, unmatched, novel } = matchSignals(beforeObs, afterObs, matchMinimum);

  const signalPair: RefactorSignalPair = {
    before: { files: beforeFiles, observations: beforeObs },
    after: { files: afterFiles, observations: afterObs },
    unmatched,
    novel,
    matched,
  };

  // Build audit context from refactorType
  const auditContext: AuditContext = {
    flaggedKinds: new Set<string>(),
    flaggedLocations: [],
    refactorType: manifest.refactorType as AuditContext['refactorType'],
  };

  const report = interpretRefactorIntent(signalPair, auditContext);

  // Compare against expected classifications
  let correct = 0;
  const total = manifest.expectedClassifications.length;
  const details: string[] = [];

  for (const expected of manifest.expectedClassifications) {
    // Find the signal that matches this expected classification by kind + evidence
    const matchingSignal = report.signals.find(s => {
      if (s.kind !== expected.kind) return false;
      const sEvidence = s.evidence as Record<string, unknown>;
      for (const [key, value] of Object.entries(expected.evidence)) {
        if (sEvidence[key] !== value) return false;
      }
      return true;
    });

    if (!matchingSignal) {
      details.push(`MISS: ${expected.kind} (${JSON.stringify(expected.evidence)}) -- no matching signal found`);
      continue;
    }

    if (matchingSignal.classification === expected.expectedClassification) {
      correct++;
    } else {
      details.push(
        `WRONG: ${expected.kind} (${JSON.stringify(expected.evidence)}) -- ` +
          `expected ${expected.expectedClassification}, got ${matchingSignal.classification}`,
      );
    }
  }

  return { correct, total, details };
}

// ---------------------------------------------------------------------------
// Parity fixture evaluation
// ---------------------------------------------------------------------------

function buildInventoryFromFile(filePath: string): PwSpecInventory {
  return analyzeTestParity(filePath);
}

function buildHelperIndexFromFiles(helperPaths: string[]): PwHelperIndex | undefined {
  if (helperPaths.length === 0) return undefined;

  const entries: import('../types').PwHelperEntry[] = [];
  for (const hp of helperPaths) {
    entries.push(...analyzeHelperFile(hp));
  }

  const lookup: Record<string, number> = {};
  for (const entry of entries) {
    lookup[entry.qualifiedName] = entry.assertionCount;
  }

  return { entries, lookup };
}

function evaluateParityFixture(
  fixtureDir: string,
  manifest: ParityManifest,
): { correct: number; total: number; details: string[] } {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const tmpDir = createTempDir(fixtureDir);

  // Write ALL fixture files to temp dir before analysis. Helpers must
  // be present before target analysis for cross-file factory resolution.
  const allFiles = [...manifest.sourceFiles, ...manifest.targetFiles, ...manifest.helperFiles];
  for (const f of allFiles) {
    const content = fs.readFileSync(path.join(basePath, f), 'utf-8');
    fs.writeFileSync(path.join(tmpDir, f), content);
  }

  const sourceInventories = manifest.sourceFiles.map(f => buildInventoryFromFile(path.join(tmpDir, f)));
  const targetInventories = manifest.targetFiles.map(f => buildInventoryFromFile(path.join(tmpDir, f)));

  // Build helper index
  const helperPaths = manifest.helperFiles.map(f => path.join(tmpDir, f));
  const targetHelpers = buildHelperIndexFromFiles(helperPaths);

  // Build file mapping from source -> target basenames
  const fileMapping: Record<string, string> = {};
  for (let i = 0; i < manifest.sourceFiles.length; i++) {
    const sourceBase = path.basename(manifest.sourceFiles[i]);
    const targetBase = manifest.targetFiles[i] ? path.basename(manifest.targetFiles[i]) : sourceBase;
    fileMapping[sourceBase] = targetBase;
  }

  const report = interpretTestParity(sourceInventories, targetInventories, fileMapping, {
    targetHelpers,
  });

  // Compare against expected classifications
  let correct = 0;
  const total = manifest.expectedClassifications.length;
  const details: string[] = [];

  for (const expected of manifest.expectedClassifications) {
    const allMatches = report.fileMatches.flatMap(fm => fm.testMatches);
    const matchingTest = allMatches.find(tm => tm.sourceTest === expected.testName);

    if (!matchingTest) {
      details.push(`MISS: test "${expected.testName}" -- no matching test found in report`);
      continue;
    }

    if (matchingTest.status === expected.expectedStatus) {
      correct++;
    } else {
      details.push(
        `WRONG: test "${expected.testName}" -- expected ${expected.expectedStatus}, got ${matchingTest.status}` +
          (matchingTest.similarity > 0 ? ` (sim=${matchingTest.similarity.toFixed(2)})` : ''),
      );
    }
  }

  return { correct, total, details };
}

// ---------------------------------------------------------------------------
// Vitest parity fixture evaluation
// ---------------------------------------------------------------------------

function evaluateVitestParityFixture(
  fixtureDir: string,
  manifest: VitestParityManifest,
): { correct: number; total: number; details: string[] } {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const tmpDir = createTempDir(fixtureDir);

  // Write all fixture files to temp dir
  const allFiles = [...manifest.sourceFiles, ...manifest.targetFiles];
  for (const f of allFiles) {
    const content = fs.readFileSync(path.join(basePath, f), 'utf-8');
    fs.writeFileSync(path.join(tmpDir, f), content);
  }

  // Analyze each file. The interpreter matches source<->target by .file,
  // so normalize both to a shared key derived from the basename with the
  // source-/target- prefix stripped.
  const sourceInventories: VtSpecInventory[] = manifest.sourceFiles.map(f => {
    const inv = analyzeVitestParity(path.join(tmpDir, f));
    const key = f.replace(/^source-/, '');
    return { ...inv, file: key };
  });

  const targetInventories: VtSpecInventory[] = manifest.targetFiles.map(f => {
    const inv = analyzeVitestParity(path.join(tmpDir, f));
    const key = f.replace(/^target-/, '');
    return { ...inv, file: key };
  });

  const report = interpretVitestParity(sourceInventories, targetInventories);

  // Compare against expected classifications
  let correct = 0;
  const total = manifest.expectedClassifications.length;
  const details: string[] = [];

  for (const expected of manifest.expectedClassifications) {
    const matchingTest = report.matches.find(m => m.sourceTest === expected.testName);

    if (!matchingTest) {
      details.push(`MISS: test "${expected.testName}" -- no matching test found in report`);
      continue;
    }

    if (matchingTest.status === expected.expectedStatus) {
      correct++;
    } else {
      details.push(
        `WRONG: test "${expected.testName}" -- expected ${expected.expectedStatus}, got ${matchingTest.status}` +
          (matchingTest.similarity > 0 ? ` (sim=${matchingTest.similarity.toFixed(2)})` : ''),
      );
    }
  }

  return { correct, total, details };
}

// ---------------------------------------------------------------------------
// Entry-based fixture evaluation
// ---------------------------------------------------------------------------

const LINE_TOLERANCE = 2;

/**
 * Run the correct interpreter pipeline for a single file and return all
 * assessments. Each tool has a different observation -> interpretation chain.
 */
function runInterpreterForFile(tool: EntryTool, filePath: string, fixtureDir: string): readonly Assessment[] {
  switch (tool) {
    case 'effects': {
      const inventory = analyzeReactFile(filePath);
      const effectObs = inventory.components.flatMap(c => c.effectObservations);
      return interpretEffects(effectObs).assessments;
    }
    case 'hooks': {
      const inventory = analyzeReactFile(filePath);
      return interpretHooks(inventory.hookObservations).assessments;
    }
    case 'ownership': {
      const inventory = analyzeReactFile(filePath);
      const hookResult = interpretHooks(inventory.hookObservations);
      const inputs: OwnershipInputs = {
        hookAssessments: hookResult.assessments,
        componentObservations: inventory.componentObservations,
        hookObservations: inventory.hookObservations,
      };
      return interpretOwnership(inputs).assessments;
    }
    case 'template': {
      const observations = extractJsxObservations(filePath);
      return interpretTemplate(observations).assessments;
    }
    case 'test-quality': {
      const analysis = analyzeTestFile(filePath);
      // subjectPath is relative to PROJECT_ROOT; derive domain dir from it
      // (same basis as targetResolvedPath in MOCK_TARGET_RESOLVED observations)
      const subjectDomainDir = analysis.subjectPath ? path.dirname(analysis.subjectPath) : '';
      return interpretTestQuality(analysis.observations, astConfig, subjectDomainDir, analysis.subjectExists)
        .assessments;
    }
    case 'dead-code': {
      // Dead-code needs the graph scoped to the fixture directory.
      // Pass searchDir so findConsumerFiles searches within the temp dir
      // instead of the repo's src/.
      const graph = buildDependencyGraph(fixtureDir, { searchDir: fixtureDir });
      const obsResult = extractImportObservations(graph);
      return interpretDeadCode(obsResult.observations, graph).assessments;
    }
  }
}

/**
 * Evaluate a single entry-based fixture against ground-truth classifications.
 * Matches assessments by file basename + line (within +/- LINE_TOLERANCE) + symbol.
 */
function evaluateEntryFixture(
  fixtureDir: string,
  manifest: EntryManifest,
): { correct: number; total: number; details: string[] } {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const tmpDir = createTempDir(fixtureDir);

  // Copy fixture files to temp dir (support subdirectory paths)
  for (const f of manifest.files) {
    const content = fs.readFileSync(path.join(basePath, f), 'utf-8');
    const targetPath = path.join(tmpDir, f);
    const targetDir = path.dirname(targetPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    fs.writeFileSync(targetPath, content);
  }

  // Run interpreter on each file and collect all assessments.
  // For test-quality, only analyze test/spec files (companion subject files
  // are present for subject detection but are not themselves analyzed).
  // For dead-code, run once for the entire directory (the dependency graph
  // is directory-scoped, not per-file).
  const isTestFile = (f: string) => /\.(spec|test)\.(ts|tsx)$/.test(f);
  const filesToAnalyze = manifest.tool === 'test-quality' ? manifest.files.filter(isTestFile) : manifest.files;

  const allAssessments: Assessment[] = [];
  if (manifest.tool === 'dead-code') {
    const assessments = runInterpreterForFile('dead-code', '', tmpDir);
    allAssessments.push(...assessments);
  } else {
    for (const f of filesToAnalyze) {
      const filePath = path.join(tmpDir, f);
      const assessments = runInterpreterForFile(manifest.tool, filePath, tmpDir);
      allAssessments.push(...assessments);
    }
  }

  // Negative fixtures: empty expectedClassifications means "expect zero
  // assessments." Any assessment emitted is a false positive.
  if (manifest.expectedClassifications.length === 0) {
    if (allAssessments.length === 0) {
      return { correct: 1, total: 1, details: [] };
    }
    const details = allAssessments.map(
      a =>
        `FALSE_POSITIVE: ${a.kind} at ${path.basename(a.subject.file)}:${a.subject.line} ` +
        `(${a.subject.symbol}) -- expected no assessments`,
    );
    return { correct: 0, total: 1, details };
  }

  // Compare against expected classifications
  let correct = 0;
  const total = manifest.expectedClassifications.length;
  const details: string[] = [];

  for (const expected of manifest.expectedClassifications) {
    // First try: exact match including expectedKind (avoids ambiguity when
    // multiple assessments share the same file/line/symbol, e.g. DETECTED_STRATEGY
    // and CLEANUP_COMPLETE both have line=undefined and no symbol).
    let matchingAssessment = allAssessments.find(a => {
      if (a.kind !== expected.expectedKind) return false;
      const assessmentFile = path.basename(a.subject.file);
      const expectedFile = path.basename(expected.file);
      if (assessmentFile !== expectedFile) return false;

      const assessmentLine = a.subject.line ?? 0;
      if (Math.abs(assessmentLine - expected.line) > LINE_TOLERANCE) return false;

      if (expected.symbol && a.subject.symbol !== expected.symbol) return false;

      return true;
    });

    // Fallback: location-only match (catches misclassifications so they report
    // WRONG instead of MISS, which is more informative for calibration).
    if (!matchingAssessment) {
      matchingAssessment = allAssessments.find(a => {
        const assessmentFile = path.basename(a.subject.file);
        const expectedFile = path.basename(expected.file);
        if (assessmentFile !== expectedFile) return false;

        const assessmentLine = a.subject.line ?? 0;
        if (Math.abs(assessmentLine - expected.line) > LINE_TOLERANCE) return false;

        if (expected.symbol && a.subject.symbol !== expected.symbol) return false;

        return true;
      });
    }

    if (!matchingAssessment) {
      details.push(
        `MISS: ${expected.expectedKind} at ${expected.file}:${expected.line} ` +
          `(${expected.symbol}) -- no matching assessment found`,
      );
      continue;
    }

    if (matchingAssessment.kind === expected.expectedKind) {
      correct++;
    } else {
      details.push(
        `WRONG: ${expected.file}:${expected.line} (${expected.symbol}) -- ` +
          `expected ${expected.expectedKind}, got ${matchingAssessment.kind}`,
      );
    }
  }

  return { correct, total, details };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const allFixtures = discoverFixtures();
const intentFixtures = allFixtures.filter(f => f.manifest.tool === 'intent');
const parityFixtures = allFixtures.filter(f => f.manifest.tool === 'parity');
const vitestParityFixtures = allFixtures.filter(f => f.manifest.tool === 'vitest-parity');
const effectsFixtures = allFixtures.filter(f => f.manifest.tool === 'effects');
const hooksFixtures = allFixtures.filter(f => f.manifest.tool === 'hooks');
const ownershipFixtures = allFixtures.filter(f => f.manifest.tool === 'ownership');
const templateFixtures = allFixtures.filter(f => f.manifest.tool === 'template');
const testQualityFixtures = allFixtures.filter(f => f.manifest.tool === 'test-quality');
const deadCodeFixtures = allFixtures.filter(f => f.manifest.tool === 'dead-code');

describe('Intent matcher accuracy', () => {
  it.skipIf(intentFixtures.length === 0)('meets accuracy threshold on all intent fixtures', { timeout: 30_000 }, () => {
    let totalCorrect = 0;
    let totalExpected = 0;
    const fixtureResults: Array<{ dir: string; correct: number; total: number; details: string[] }> = [];

    for (const { dir, manifest } of intentFixtures) {
      const result = evaluateIntentFixture(dir, manifest as IntentManifest);
      totalCorrect += result.correct;
      totalExpected += result.total;
      fixtureResults.push({ dir, ...result });
    }

    const accuracy = totalExpected > 0 ? totalCorrect / totalExpected : 0;
    const threshold = 0.6; // minimum 60% accuracy

    // Output per-fixture details for debugging
    for (const r of fixtureResults) {
      if (r.details.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`\n[${r.dir}] ${r.correct}/${r.total}:`);
        for (const d of r.details) {
          // eslint-disable-next-line no-console
          console.error(`  ${d}`);
        }
      }
    }

    // Per-fixture regression check: no single fixture should score below 50%
    for (const r of fixtureResults) {
      const fixtureAccuracy = r.total > 0 ? r.correct / r.total : 0;
      expect(
        fixtureAccuracy,
        `Fixture [${r.dir}] accuracy ${(fixtureAccuracy * 100).toFixed(1)}% is below 50%. ` +
          `${r.correct}/${r.total} correct. Details: ${r.details.join('; ')}`,
      ).toBeGreaterThanOrEqual(0.5);
    }

    expect(
      accuracy,
      `Intent accuracy ${(accuracy * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%. ` +
        `${totalCorrect}/${totalExpected} classifications correct across ${intentFixtures.length} fixtures.`,
    ).toBeGreaterThanOrEqual(threshold);
  });
});

describe('Parity tool accuracy', () => {
  it.skipIf(parityFixtures.length === 0)('meets accuracy threshold on all parity fixtures', { timeout: 30_000 }, () => {
    let totalCorrect = 0;
    let totalExpected = 0;
    const fixtureResults: Array<{ dir: string; correct: number; total: number; details: string[] }> = [];

    for (const { dir, manifest } of parityFixtures) {
      const result = evaluateParityFixture(dir, manifest as ParityManifest);
      totalCorrect += result.correct;
      totalExpected += result.total;
      fixtureResults.push({ dir, ...result });
    }

    const accuracy = totalExpected > 0 ? totalCorrect / totalExpected : 0;
    const threshold = 0.6; // minimum 60% accuracy

    // Output per-fixture details for debugging
    for (const r of fixtureResults) {
      if (r.details.length > 0) {
        // eslint-disable-next-line no-console
        console.error(`\n[${r.dir}] ${r.correct}/${r.total}:`);
        for (const d of r.details) {
          // eslint-disable-next-line no-console
          console.error(`  ${d}`);
        }
      }
    }

    // Per-fixture regression check: no single fixture should score below 50%
    for (const r of fixtureResults) {
      const fixtureAccuracy = r.total > 0 ? r.correct / r.total : 0;
      expect(
        fixtureAccuracy,
        `Fixture [${r.dir}] accuracy ${(fixtureAccuracy * 100).toFixed(1)}% is below 50%. ` +
          `${r.correct}/${r.total} correct. Details: ${r.details.join('; ')}`,
      ).toBeGreaterThanOrEqual(0.5);
    }

    expect(
      accuracy,
      `Parity accuracy ${(accuracy * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%. ` +
        `${totalCorrect}/${totalExpected} classifications correct across ${parityFixtures.length} fixtures.`,
    ).toBeGreaterThanOrEqual(threshold);
  });
});

describe('Vitest parity tool accuracy', () => {
  it.skipIf(vitestParityFixtures.length === 0)(
    'meets accuracy threshold on all vitest-parity fixtures',
    { timeout: 30_000 },
    () => {
      let totalCorrect = 0;
      let totalExpected = 0;
      const fixtureResults: Array<{ dir: string; correct: number; total: number; details: string[] }> = [];

      for (const { dir, manifest } of vitestParityFixtures) {
        const result = evaluateVitestParityFixture(dir, manifest as VitestParityManifest);
        totalCorrect += result.correct;
        totalExpected += result.total;
        fixtureResults.push({ dir, ...result });
      }

      const accuracy = totalExpected > 0 ? totalCorrect / totalExpected : 0;
      const threshold = 0.6; // minimum 60% accuracy

      // Output per-fixture details for debugging
      for (const r of fixtureResults) {
        if (r.details.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`\n[${r.dir}] ${r.correct}/${r.total}:`);
          for (const d of r.details) {
            // eslint-disable-next-line no-console
            console.error(`  ${d}`);
          }
        }
      }

      // Per-fixture regression check: no single fixture should score below 50%
      for (const r of fixtureResults) {
        const fixtureAccuracy = r.total > 0 ? r.correct / r.total : 0;
        expect(
          fixtureAccuracy,
          `Fixture [${r.dir}] accuracy ${(fixtureAccuracy * 100).toFixed(1)}% is below 50%. ` +
            `${r.correct}/${r.total} correct. Details: ${r.details.join('; ')}`,
        ).toBeGreaterThanOrEqual(0.5);
      }

      expect(
        accuracy,
        `Vitest parity accuracy ${(accuracy * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%. ` +
          `${totalCorrect}/${totalExpected} classifications correct across ${vitestParityFixtures.length} fixtures.`,
      ).toBeGreaterThanOrEqual(threshold);
    },
  );
});

// ---------------------------------------------------------------------------
// Entry-based interpreter accuracy blocks
// ---------------------------------------------------------------------------

/**
 * Shared test body for entry-based interpreter accuracy. Runs evaluateEntryFixture
 * on each fixture, asserts per-fixture >= 50% and overall >= 60%.
 */
function runEntryAccuracyTest(toolName: string, fixtures: Array<{ dir: string; manifest: Manifest }>): void {
  let totalCorrect = 0;
  let totalExpected = 0;
  const fixtureResults: Array<{ dir: string; correct: number; total: number; details: string[]; status: string }> = [];

  for (const { dir, manifest } of fixtures) {
    const result = evaluateEntryFixture(dir, manifest as EntryManifest);
    totalCorrect += result.correct;
    totalExpected += result.total;
    fixtureResults.push({ dir, ...result, status: manifest.status ?? 'calibrated' });
  }

  const accuracy = totalExpected > 0 ? totalCorrect / totalExpected : 0;
  const threshold = 0.6;

  // Output per-fixture details for debugging
  for (const r of fixtureResults) {
    if (r.details.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`\n[${r.dir}] ${r.correct}/${r.total} (${r.status}):`);
      for (const d of r.details) {
        // eslint-disable-next-line no-console
        console.error(`  ${d}`);
      }
    }
  }

  // Per-fixture regression check: no single calibrated fixture should score below 50%.
  // Pending fixtures are allowed to fail -- they exist to document known
  // misclassifications that the calibration skill will address.
  // Skip fixtures with 0 expected entries (negative-only fixtures).
  for (const r of fixtureResults) {
    if (r.total === 0) continue;
    if (r.status === 'pending') continue;
    const fixtureAccuracy = r.correct / r.total;
    expect(
      fixtureAccuracy,
      `Fixture [${r.dir}] accuracy ${(fixtureAccuracy * 100).toFixed(1)}% is below 50%. ` +
        `${r.correct}/${r.total} correct. Details: ${r.details.join('; ')}`,
    ).toBeGreaterThanOrEqual(0.5);
  }

  expect(
    accuracy,
    `${toolName} accuracy ${(accuracy * 100).toFixed(1)}% is below threshold ${(threshold * 100).toFixed(1)}%. ` +
      `${totalCorrect}/${totalExpected} classifications correct across ${fixtures.length} fixtures.`,
  ).toBeGreaterThanOrEqual(threshold);
}

describe('Effects interpreter accuracy', () => {
  it.skipIf(effectsFixtures.length === 0)('meets accuracy threshold on all effects fixtures', { timeout: 30_000 }, () =>
    runEntryAccuracyTest('Effects', effectsFixtures),
  );
});

describe('Hooks interpreter accuracy', () => {
  it.skipIf(hooksFixtures.length === 0)('meets accuracy threshold on all hooks fixtures', { timeout: 30_000 }, () =>
    runEntryAccuracyTest('Hooks', hooksFixtures),
  );
});

describe('Ownership interpreter accuracy', () => {
  it.skipIf(ownershipFixtures.length === 0)(
    'meets accuracy threshold on all ownership fixtures',
    { timeout: 30_000 },
    () => runEntryAccuracyTest('Ownership', ownershipFixtures),
  );
});

describe('Template interpreter accuracy', () => {
  it.skipIf(templateFixtures.length === 0)(
    'meets accuracy threshold on all template fixtures',
    { timeout: 30_000 },
    () => runEntryAccuracyTest('Template', templateFixtures),
  );
});

describe('Test quality interpreter accuracy', () => {
  it.skipIf(testQualityFixtures.length === 0)(
    'meets accuracy threshold on all test-quality fixtures',
    { timeout: 30_000 },
    () => runEntryAccuracyTest('Test quality', testQualityFixtures),
  );
});

describe('Dead code interpreter accuracy', () => {
  it.skipIf(deadCodeFixtures.length === 0)(
    'meets accuracy threshold on all dead-code fixtures',
    { timeout: 30_000 },
    () => runEntryAccuracyTest('Dead code', deadCodeFixtures),
  );
});
