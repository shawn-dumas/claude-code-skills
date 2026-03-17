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
import zlib from 'zlib';
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
import { analyzePlan } from '../ast-plan-audit';
import { interpretPlanAudit } from '../ast-interpret-plan-audit';
import type {
  PlanAuditVerdictReport,
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

interface PlanAuditExpectedClassification {
  expectedKind: string;
  notes: string;
}

interface PlanAuditExpectedObservation {
  kind: string;
  evidence: Record<string, unknown>;
  notes?: string;
}

interface SyntheticPlanAuditManifest {
  tool: 'plan-audit';
  source: 'synthetic';
  planFile: string;
  promptFiles: string[];
  expectedVerdict: string;
  expectedScoreRange: [number, number];
  expectedClassifications: PlanAuditExpectedClassification[];
  unexpectedClassifications?: string[];
  expectedObservationValues?: PlanAuditExpectedObservation[];
  status: string;
}

interface RealPlanAuditEntry {
  planFile: string;
  frictionGrade: string;
  expectedVerdict: string;
  cohort: string;
  currentScore: number;
  currentVerdict: string;
  rank: number | null;
  notes: string;
}

interface RealPlanAuditManifest {
  tool: 'plan-audit';
  source: 'real-world';
  conventionBoundary: string;
  plans: RealPlanAuditEntry[];
  status: string;
}

type Manifest =
  | IntentManifest
  | ParityManifest
  | VitestParityManifest
  | EntryManifest
  | SyntheticPlanAuditManifest
  | RealPlanAuditManifest;

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
      return { correct: 1, total: 1, details: [], uncoveredCount: 0, uncoveredDetails: [] };
    }
    const details = allAssessments.map(
      a =>
        `FALSE_POSITIVE: ${a.kind} at ${path.basename(a.subject.file)}:${a.subject.line} ` +
        `(${a.subject.symbol}) -- expected no assessments`,
    );
    return { correct: 0, total: 1, details, uncoveredCount: 0, uncoveredDetails: [] };
  }

  // Compare against expected classifications, tracking which assessments
  // are matched for coverage analysis.
  let correct = 0;
  const total = manifest.expectedClassifications.length;
  const details: string[] = [];
  const matchedIndices = new Set<number>();

  for (const expected of manifest.expectedClassifications) {
    // First try: exact match including expectedKind (avoids ambiguity when
    // multiple assessments share the same file/line/symbol, e.g. DETECTED_STRATEGY
    // and CLEANUP_COMPLETE both have line=undefined and no symbol).
    let matchIndex = allAssessments.findIndex(a => {
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
    if (matchIndex < 0) {
      matchIndex = allAssessments.findIndex(a => {
        const assessmentFile = path.basename(a.subject.file);
        const expectedFile = path.basename(expected.file);
        if (assessmentFile !== expectedFile) return false;

        const assessmentLine = a.subject.line ?? 0;
        if (Math.abs(assessmentLine - expected.line) > LINE_TOLERANCE) return false;

        if (expected.symbol && a.subject.symbol !== expected.symbol) return false;

        return true;
      });
    }

    if (matchIndex < 0) {
      details.push(
        `MISS: ${expected.expectedKind} at ${expected.file}:${expected.line} ` +
          `(${expected.symbol}) -- no matching assessment found`,
      );
      continue;
    }

    matchedIndices.add(matchIndex);
    const matchingAssessment = allAssessments[matchIndex];

    if (matchingAssessment.kind === expected.expectedKind) {
      correct++;
    } else {
      details.push(
        `WRONG: ${expected.file}:${expected.line} (${expected.symbol}) -- ` +
          `expected ${expected.expectedKind}, got ${matchingAssessment.kind}`,
      );
    }
  }

  // Coverage analysis: identify assessments not matched by any expected
  // classification. For feedback fixtures, these represent signals the
  // fixture author failed to classify -- the "Classify ALL" instruction
  // exists to prevent this.
  const uncoveredAssessments = allAssessments.filter((_, i) => !matchedIndices.has(i));
  const uncoveredDetails = uncoveredAssessments.map(
    a =>
      `UNCOVERED: ${a.kind} at ${path.basename(a.subject.file)}:${a.subject.line} ` +
      `(${a.subject.symbol}) -- assessment produced by interpreter but not in expectedClassifications`,
  );

  return { correct, total, details, uncoveredCount: uncoveredAssessments.length, uncoveredDetails };
}

// ---------------------------------------------------------------------------
// Plan audit fixture evaluation
// ---------------------------------------------------------------------------

const REAL_PLAN_AUDIT_DIR = path.join(FIXTURES_DIR, 'real-plan-audit');

/**
 * Resolve a plan file path from the real-plan-audit manifest.
 * - Relative paths (e.g., "plans/foo.md.gz") resolve relative to the
 *   real-plan-audit fixture directory. If .gz, decompress to a temp file.
 * - Legacy absolute paths starting with ~ resolve via homedir expansion.
 */
function resolvePlanPath(p: string): string {
  // Legacy: ~/plans/archive/foo.md
  if (p.startsWith('~')) return p.replace(/^~/, os.homedir());

  // Relative path (new convention): plans/foo.md.gz
  const resolved = path.join(REAL_PLAN_AUDIT_DIR, p);
  if (!p.endsWith('.gz')) return resolved;

  // Decompress .gz to a temp file
  if (!fs.existsSync(resolved)) return resolved;
  const compressed = fs.readFileSync(resolved);
  const decompressed = zlib.gunzipSync(compressed);
  const tmpDir = createTempDir('plan-gz');
  const basename = path.basename(p, '.gz');
  const tmpPath = path.join(tmpDir, basename);
  fs.writeFileSync(tmpPath, decompressed);
  return tmpPath;
}

function evaluateSyntheticPlanAuditFixture(
  fixtureDir: string,
  manifest: SyntheticPlanAuditManifest,
): { correct: number; total: number; details: string[] } {
  const basePath = path.join(FIXTURES_DIR, fixtureDir);
  const planPath = path.join(basePath, manifest.planFile);
  const promptPaths = manifest.promptFiles.map(f => path.join(basePath, f));

  const result = analyzePlan(planPath, promptPaths);
  const report = interpretPlanAudit(
    path.relative(process.cwd(), planPath),
    promptPaths.map(p => path.relative(process.cwd(), p)),
    result.observations,
  );

  const details: string[] = [];
  let correct = 0;
  let total = 0;

  // Check verdict
  total++;
  if (report.verdict === manifest.expectedVerdict) {
    correct++;
  } else {
    details.push(`VERDICT: expected ${manifest.expectedVerdict}, got ${report.verdict}`);
  }

  // Check score range
  total++;
  const [lo, hi] = manifest.expectedScoreRange;
  if (report.score >= lo && report.score <= hi) {
    correct++;
  } else {
    details.push(`SCORE: expected ${lo}-${hi}, got ${report.score}`);
  }

  // Check expected assessment kinds are present
  for (const expected of manifest.expectedClassifications) {
    total++;
    const found = report.assessments.some(a => a.kind === expected.expectedKind);
    if (found) {
      correct++;
    } else {
      details.push(`MISS: expected assessment kind ${expected.expectedKind} not found`);
    }
  }

  // Check unexpected assessment kinds are absent
  if (manifest.unexpectedClassifications) {
    for (const unexpected of manifest.unexpectedClassifications) {
      total++;
      const found = report.assessments.some(a => a.kind === unexpected);
      if (!found) {
        correct++;
      } else {
        details.push(`UNEXPECTED: assessment kind ${unexpected} should not appear`);
      }
    }
  }

  // Check expected observation evidence values
  if (manifest.expectedObservationValues) {
    for (const expected of manifest.expectedObservationValues) {
      total++;
      const obs = result.observations.find(o => o.kind === expected.kind);
      if (!obs) {
        details.push(`OBS_MISS: expected observation ${expected.kind} not found`);
      } else {
        let match = true;
        for (const [key, expectedValue] of Object.entries(expected.evidence)) {
          const actualValue = (obs.evidence as Record<string, unknown>)[key];
          if (actualValue !== expectedValue) {
            match = false;
            details.push(
              `OBS_VALUE: ${expected.kind}.${key} expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
          }
        }
        if (match) correct++;
      }
    }
  }

  return { correct, total, details };
}

function evaluateRealPlanAuditFixtures(manifest: RealPlanAuditManifest): {
  overall: { correct: number; total: number };
  byCohort: Record<string, { correct: number; total: number }>;
  byGrade: Record<string, { correct: number; total: number }>;
  details: string[];
} {
  let totalCorrect = 0;
  let totalPlans = 0;
  const byCohort: Record<string, { correct: number; total: number }> = {};
  const byGrade: Record<string, { correct: number; total: number }> = {};
  const details: string[] = [];

  for (const entry of manifest.plans) {
    const planPath = resolvePlanPath(entry.planFile);
    if (!fs.existsSync(planPath)) {
      details.push(`SKIP: ${entry.planFile} (file not found)`);
      continue;
    }

    const result = analyzePlan(planPath, []);
    const report = interpretPlanAudit(planPath, [], result.observations);

    totalPlans++;
    const match = report.verdict === entry.expectedVerdict;
    if (match) totalCorrect++;
    else {
      details.push(
        `${entry.frictionGrade} ${entry.cohort}: ${path.basename(entry.planFile)} -- ` +
          `expected ${entry.expectedVerdict}, got ${report.verdict} (score ${report.score})`,
      );
    }

    // Aggregate by cohort
    if (!byCohort[entry.cohort]) byCohort[entry.cohort] = { correct: 0, total: 0 };
    byCohort[entry.cohort].total++;
    if (match) byCohort[entry.cohort].correct++;

    // Aggregate by grade
    if (!byGrade[entry.frictionGrade]) byGrade[entry.frictionGrade] = { correct: 0, total: 0 };
    byGrade[entry.frictionGrade].total++;
    if (match) byGrade[entry.frictionGrade].correct++;
  }

  return {
    overall: { correct: totalCorrect, total: totalPlans },
    byCohort,
    byGrade,
    details,
  };
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
const syntheticPlanAuditFixtures = allFixtures.filter(
  f =>
    f.manifest.tool === 'plan-audit' &&
    (f.manifest as SyntheticPlanAuditManifest | RealPlanAuditManifest).source === 'synthetic',
);
const realPlanAuditFixtures = allFixtures.filter(
  f =>
    f.manifest.tool === 'plan-audit' &&
    (f.manifest as SyntheticPlanAuditManifest | RealPlanAuditManifest).source === 'real-world',
);

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
  const fixtureResults: Array<{
    dir: string;
    correct: number;
    total: number;
    details: string[];
    status: string;
    source: string;
    uncoveredCount: number;
    uncoveredDetails: string[];
  }> = [];

  for (const { dir, manifest } of fixtures) {
    const result = evaluateEntryFixture(dir, manifest as EntryManifest);
    totalCorrect += result.correct;
    totalExpected += result.total;
    fixtureResults.push({
      dir,
      ...result,
      status: manifest.status ?? 'calibrated',
      source: (manifest as EntryManifest).source ?? '',
    });
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

  // Coverage enforcement for feedback fixtures. Feedback fixtures must
  // classify ALL signals the interpreter produces, not just the
  // misclassified one. This is the machine-enforced counterpart of the
  // "Classify ALL" instruction in skill prose. Without this check,
  // agents reliably create fixtures with only the misclassified entry,
  // making the ground truth incomplete for calibration.
  for (const r of fixtureResults) {
    if (r.source !== 'feedback') continue;
    if (r.uncoveredCount === 0) continue;

    // eslint-disable-next-line no-console
    console.error(`\n[${r.dir}] INCOMPLETE COVERAGE (${r.uncoveredCount} uncovered):`);
    for (const d of r.uncoveredDetails) {
      // eslint-disable-next-line no-console
      console.error(`  ${d}`);
    }

    expect(
      r.uncoveredCount,
      `Feedback fixture [${r.dir}] has ${r.uncoveredCount} uncovered assessment(s). ` +
        `Feedback fixtures must classify ALL signals -- the calibration skill needs ` +
        `the full picture to tune weights without regressing other classifications. ` +
        `Add the missing assessments to expectedClassifications. ` +
        `See scripts/AST/docs/ast-feedback-loop.md for the fixture authoring guide.`,
    ).toBe(0);
  }
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

// ---------------------------------------------------------------------------
// Plan audit interpreter accuracy
// ---------------------------------------------------------------------------

describe('Plan audit interpreter accuracy (synthetic)', () => {
  it.skipIf(syntheticPlanAuditFixtures.length === 0)(
    'meets accuracy threshold on all synthetic plan-audit fixtures',
    { timeout: 30_000 },
    () => {
      let totalCorrect = 0;
      let totalExpected = 0;
      const fixtureResults: Array<{ dir: string; correct: number; total: number; details: string[] }> = [];

      for (const { dir, manifest } of syntheticPlanAuditFixtures) {
        const result = evaluateSyntheticPlanAuditFixture(dir, manifest as SyntheticPlanAuditManifest);
        totalCorrect += result.correct;
        totalExpected += result.total;
        fixtureResults.push({ dir, ...result });
      }

      const accuracy = totalExpected > 0 ? totalCorrect / totalExpected : 0;
      const threshold = 0.9; // synthetic fixtures should be nearly perfect

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

      // Per-fixture check: each synthetic fixture should be 100%
      for (const r of fixtureResults) {
        const fixtureAccuracy = r.total > 0 ? r.correct / r.total : 0;
        expect(
          fixtureAccuracy,
          `Fixture [${r.dir}] accuracy ${(fixtureAccuracy * 100).toFixed(1)}% is below 100%. ` +
            `${r.correct}/${r.total} correct. Details: ${r.details.join('; ')}`,
        ).toBe(1);
      }

      expect(
        accuracy,
        `Plan audit (synthetic) accuracy ${(accuracy * 100).toFixed(1)}% is below ${(threshold * 100).toFixed(1)}%. ` +
          `${totalCorrect}/${totalExpected} checks correct across ${syntheticPlanAuditFixtures.length} fixtures.`,
      ).toBeGreaterThanOrEqual(threshold);
    },
  );
});

describe('Plan audit interpreter accuracy (real-world calibration)', () => {
  it.skipIf(realPlanAuditFixtures.length === 0)(
    'reports calibration accuracy by cohort and friction grade',
    { timeout: 120_000 },
    () => {
      for (const { dir, manifest } of realPlanAuditFixtures) {
        const result = evaluateRealPlanAuditFixtures(manifest as RealPlanAuditManifest);

        // Report per-cohort accuracy
        // eslint-disable-next-line no-console
        console.error(`\n[${dir}] Overall: ${result.overall.correct}/${result.overall.total}`);
        for (const [cohort, stats] of Object.entries(result.byCohort)) {
          const pct = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : '0';
          // eslint-disable-next-line no-console
          console.error(`  ${cohort}: ${stats.correct}/${stats.total} (${pct}%)`);
        }
        for (const [grade, stats] of Object.entries(result.byGrade)) {
          const pct = stats.total > 0 ? ((stats.correct / stats.total) * 100).toFixed(1) : '0';
          // eslint-disable-next-line no-console
          console.error(`  ${grade}: ${stats.correct}/${stats.total} (${pct}%)`);
        }

        if (result.details.length > 0) {
          // eslint-disable-next-line no-console
          console.error(`  Mismatches:`);
          for (const d of result.details.slice(0, 10)) {
            // eslint-disable-next-line no-console
            console.error(`    ${d}`);
          }
          if (result.details.length > 10) {
            // eslint-disable-next-line no-console
            console.error(`    ... and ${result.details.length - 10} more`);
          }
        }

        // --- Gated assertions ---

        // 1. HELLACIOUS plans should all be BLOCKED (100%).
        // This is the only grade the interpreter reliably classifies
        // across both cohorts. A regression here indicates a real problem.
        const hellacious = result.byGrade['HELLACIOUS'];
        if (hellacious && hellacious.total > 0) {
          const hellaciousAccuracy = hellacious.correct / hellacious.total;
          expect(
            hellaciousAccuracy,
            `HELLACIOUS->BLOCKED accuracy ${(hellaciousAccuracy * 100).toFixed(1)}% dropped below 100%. ` +
              `${hellacious.correct}/${hellacious.total} correct.`,
          ).toBe(1);
        }

        // 2. Post-convention accuracy is the primary calibration target.
        // The interpreter measures structural quality against conventions
        // that only exist in post-convention plans. Pre-convention plans
        // fail structural checks for reasons unrelated to plan quality
        // (the checks didn't exist when the plans were written). Per
        // dialectic 2026-03-16: calibrate against post-convention only,
        // report pre-convention as monitoring.
        //
        // Current baseline: 38% (5/13 post-convention).
        // Achievable ceiling with threshold tuning: 69% (9/13) but
        // requires cert=60 which collapses SMOOTH/ROUGH distinction.
        // Threshold is set low (25%) to catch regressions without
        // blocking on the known SMOOTH/ROUGH overlap. Will rise as
        // corpus grows and complexity metrics are added.
        const postConv = result.byCohort['post-convention'];
        if (postConv && postConv.total > 0) {
          const postConvAccuracy = postConv.correct / postConv.total;
          // eslint-disable-next-line no-console
          console.error(
            `\n  POST-CONVENTION ACCURACY: ${(postConvAccuracy * 100).toFixed(1)}% (${postConv.correct}/${postConv.total})`,
          );
          expect(
            postConvAccuracy,
            `Post-convention accuracy ${(postConvAccuracy * 100).toFixed(1)}% dropped below 25%. ` +
              `${postConv.correct}/${postConv.total} correct. ` +
              `This is the primary calibration target for plan-audit.`,
          ).toBeGreaterThanOrEqual(0.25);
        }

        // 3. Pre-convention: monitoring only, no gated threshold.
        // These plans predate structural conventions and are expected
        // to score poorly. Tracked for corpus-level visibility.
        const preConv = result.byCohort['pre-convention'];
        if (preConv && preConv.total > 0) {
          const preConvAccuracy = preConv.correct / preConv.total;
          // eslint-disable-next-line no-console
          console.error(
            `  PRE-CONVENTION ACCURACY: ${(preConvAccuracy * 100).toFixed(1)}% (${preConv.correct}/${preConv.total}) [monitoring only]`,
          );
        }

        // 4. Overall accuracy: monitoring only.
        const overallAccuracy = result.overall.total > 0 ? result.overall.correct / result.overall.total : 0;
        // eslint-disable-next-line no-console
        console.error(`  OVERALL BASELINE: ${(overallAccuracy * 100).toFixed(1)}%`);
      }
    },
  );
});
