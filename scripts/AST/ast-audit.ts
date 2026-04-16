#!/usr/bin/env npx tsx
/**
 * ast-audit.ts -- Deterministic codebase audit CLI.
 *
 * Runs all observation tools, interpreters, and the finding mapper to
 * produce a complete audit in a single command. No agent inference.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-audit.ts <path...> [options]
 *
 * Options:
 *   --output <dir>       Output directory (default: stdout summary)
 *   --no-cache           Force recompute all tools
 *   --json               Output findings.json to stdout
 *   --diff <dir>         Diff against previous audit's findings.json
 *   --track <fe|bff>     Only include one track
 *   --min-priority <P>   Minimum priority to include (default: P4)
 */
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

import { PROJECT_ROOT, getSourceFile } from './project';
import { getFilesInDirectory } from './shared';
import { runAllObservers, runObservers } from './tool-registry';
import { buildDependencyGraph, extractImportObservations } from './ast-imports';
import { getCacheStats } from './ast-cache';
import { astConfig } from './ast-config';

// Interpreters
import { interpretEffects } from './ast-interpret-effects';
import { interpretHooks } from './ast-interpret-hooks';
import { interpretOwnership, type OwnershipInputs } from './ast-interpret-ownership';
import { interpretTemplate } from './ast-interpret-template';
import { interpretDeadCode } from './ast-interpret-dead-code';
import { interpretTestQuality } from './ast-interpret-test-quality';
import { interpretTestCoverage } from './ast-interpret-test-coverage';
import { interpretDisplayFormat } from './ast-interpret-display-format';

// Finding mapper
import {
  observationsToFindings,
  effectAssessmentsToFindings,
  ownershipAssessmentsToFindings,
  deadCodeAssessmentsToFindings,
  templateAssessmentsToFindings,
  testQualityAssessmentsToFindings,
  testCoverageAssessmentsToFindings,
  displayFormatAssessmentsToFindings,
  deduplicateAndSort,
} from './ast-audit-findings';

// Report renderer
import { renderJson, renderMarkdownSummary, computeDiff, renderDiff, type AuditMetadata } from './ast-audit-report';

// Types
import type {
  Observation,
  Finding,
  FindingTrack,
  AuditPriority,
  EffectObservation,
  HookObservation,
  ComponentObservation,
  SideEffectObservation,
  JsxObservation,
  ImportObservation,
  TestObservation,
  NumberFormatObservation,
  NullDisplayObservation,
  TestCoverageObservation,
} from './types';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface AuditArgs {
  paths: string[];
  outputDir: string | null;
  noCache: boolean;
  json: boolean;
  diffDir: string | null;
  track: FindingTrack | null;
  minPriority: AuditPriority;
}

export function parseAuditArgs(argv: string[]): AuditArgs {
  const raw = argv.slice(2);
  const paths: string[] = [];
  let outputDir: string | null = null;
  let noCache = false;
  let json = false;
  let diffDir: string | null = null;
  let track: FindingTrack | null = null;
  let minPriority: AuditPriority = 'P4';

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--output' && i + 1 < raw.length) {
      outputDir = raw[++i];
    } else if (arg === '--no-cache') {
      noCache = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--diff' && i + 1 < raw.length) {
      diffDir = raw[++i];
    } else if (arg === '--track' && i + 1 < raw.length) {
      const t = raw[++i];
      if (t === 'fe' || t === 'bff') track = t;
    } else if (arg === '--min-priority' && i + 1 < raw.length) {
      const p = raw[++i];
      if (['P1', 'P2', 'P3', 'P4', 'P5'].includes(p)) minPriority = p as AuditPriority;
    } else if (!arg.startsWith('-')) {
      paths.push(arg);
    }
  }

  if (paths.length === 0) paths.push('src/');
  return { paths, outputDir, noCache, json, diffDir, track, minPriority };
}

// ---------------------------------------------------------------------------
// Observation kind routing
// ---------------------------------------------------------------------------

const EFFECT_KINDS = new Set([
  'EFFECT_LOCATION',
  'EFFECT_DEP_ENTRY',
  'EFFECT_STATE_SETTER_CALL',
  'EFFECT_FETCH_CALL',
  'EFFECT_TIMER_CALL',
  'EFFECT_NAVIGATION_CALL',
  'EFFECT_STORAGE_CALL',
  'EFFECT_TOAST_CALL',
  'EFFECT_CLEANUP_PRESENT',
  'EFFECT_ASYNC_CALL',
  'EFFECT_PROP_READ',
  'EFFECT_CONTEXT_READ',
  'EFFECT_REF_TOUCH',
  'EFFECT_DOM_API',
  'EFFECT_BODY_DEP_CALL',
]);
const HOOK_KINDS = new Set(['HOOK_CALL', 'HOOK_IMPORT', 'HOOK_DEFINITION']);
const COMPONENT_KINDS = new Set(['COMPONENT_DECLARATION', 'PROP_FIELD']);
const SIDE_EFFECT_KINDS = new Set(['CONSOLE_CALL', 'TOAST_CALL', 'TIMER_CALL', 'POSTHOG_CALL', 'WINDOW_MUTATION']);
const JSX_KINDS = new Set([
  'JSX_TERNARY_CHAIN',
  'JSX_GUARD_CHAIN',
  'JSX_TRANSFORM_CHAIN',
  'JSX_IIFE',
  'JSX_INLINE_HANDLER',
  'JSX_INLINE_STYLE',
  'JSX_COMPLEX_CLASSNAME',
  'JSX_RETURN_BLOCK',
]);
const IMPORT_KINDS = new Set([
  'STATIC_IMPORT',
  'DYNAMIC_IMPORT',
  'REEXPORT_IMPORT',
  'SIDE_EFFECT_IMPORT',
  'EXPORT_DECLARATION',
  'CIRCULAR_DEPENDENCY',
  'DEAD_EXPORT_CANDIDATE',
]);
const NUMBER_FORMAT_KINDS = new Set([
  'FORMAT_NUMBER_CALL',
  'FORMAT_INT_CALL',
  'FORMAT_DURATION_CALL',
  'FORMAT_CELL_VALUE_CALL',
  'RAW_TO_FIXED',
  'RAW_TO_LOCALE_STRING',
  'PERCENTAGE_DISPLAY',
  'INTL_NUMBER_FORMAT',
]);
const NULL_DISPLAY_KINDS = new Set([
  'NULL_COALESCE_FALLBACK',
  'FALSY_COALESCE_FALLBACK',
  'NO_FALLBACK_CELL',
  'HARDCODED_PLACEHOLDER',
  'EMPTY_STATE_MESSAGE',
  'ZERO_CONFLATION',
]);
const TEST_COVERAGE_KINDS = new Set(['TEST_COVERAGE']);

interface GroupedObservations {
  effect: EffectObservation[];
  hook: HookObservation[];
  component: ComponentObservation[];
  sideEffect: SideEffectObservation[];
  jsx: JsxObservation[];
  import: ImportObservation[];
  numberFormat: NumberFormatObservation[];
  nullDisplay: NullDisplayObservation[];
  testCoverage: TestCoverageObservation[];
  all: Observation[];
}

export function groupObservations(observations: Observation[]): GroupedObservations {
  const groups: GroupedObservations = {
    effect: [],
    hook: [],
    component: [],
    sideEffect: [],
    jsx: [],
    import: [],
    numberFormat: [],
    nullDisplay: [],
    testCoverage: [],
    all: observations,
  };

  for (const obs of observations) {
    if (EFFECT_KINDS.has(obs.kind)) groups.effect.push(obs as EffectObservation);
    else if (HOOK_KINDS.has(obs.kind)) groups.hook.push(obs as HookObservation);
    else if (COMPONENT_KINDS.has(obs.kind)) groups.component.push(obs as ComponentObservation);
    else if (SIDE_EFFECT_KINDS.has(obs.kind)) groups.sideEffect.push(obs as SideEffectObservation);
    else if (JSX_KINDS.has(obs.kind)) groups.jsx.push(obs as JsxObservation);
    else if (IMPORT_KINDS.has(obs.kind)) groups.import.push(obs as ImportObservation);
    else if (NUMBER_FORMAT_KINDS.has(obs.kind)) groups.numberFormat.push(obs as NumberFormatObservation);
    else if (NULL_DISPLAY_KINDS.has(obs.kind)) groups.nullDisplay.push(obs as NullDisplayObservation);
    else if (TEST_COVERAGE_KINDS.has(obs.kind)) groups.testCoverage.push(obs as TestCoverageObservation);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Priority filter
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

export function filterByPriority(findings: Finding[], minPriority: AuditPriority): Finding[] {
  const maxRank = PRIORITY_RANK[minPriority] ?? 4;
  return findings.filter(f => (PRIORITY_RANK[f.priority] ?? 5) <= maxRank);
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
  } catch {
    /* v8 ignore start -- defensive: git always available in CI/dev; catch branch is a safety net */
    return 'unknown';
    /* v8 ignore stop */
  }
}

function gitHead(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
  } catch {
    /* v8 ignore start -- defensive: git always available in CI/dev; catch branch is a safety net */
    return 'unknown';
    /* v8 ignore stop */
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Find the deepest directory that is an ancestor of all given paths. */
export function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return PROJECT_ROOT;
  if (paths.length === 1) return paths[0];

  const segments = paths.map(p => p.split(path.sep));
  const minLen = Math.min(...segments.map(s => s.length));
  let common = '';
  for (let i = 0; i < minLen; i++) {
    const segment = segments[0][i];
    if (segments.every(s => s[i] === segment)) {
      common += segment + path.sep;
    } else {
      break;
    }
  }
  // Remove trailing separator and ensure the result is a valid directory.
  // The `common` (non-sep) branch of the ternary is only reachable on Windows
  // where common can be empty without a leading slash; on POSIX all paths share
  // '/' so common always ends with sep when non-empty.
  /* v8 ignore start -- defensive: unreachable on POSIX (common always ends with sep) */
  const result = common.endsWith(path.sep) ? common.slice(0, -1) : common;
  /* v8 ignore stop */
  return result || PROJECT_ROOT;
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export function main(): void {
  const args = parseAuditArgs(process.argv);
  const startTime = Date.now();
  let phaseStart = performance.now();

  // Phase 1: File discovery
  process.stderr.write('Phase 1: Discovering files...\n');
  const prodFiles: string[] = [];
  const testFiles: string[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);
    if (!fs.existsSync(absolute)) {
      process.stderr.write(`Path does not exist: ${targetPath}\n`);
      process.exit(1);
    }
    if (fs.statSync(absolute).isDirectory()) {
      prodFiles.push(...getFilesInDirectory(absolute, 'production'));
      testFiles.push(...getFilesInDirectory(absolute, 'test'));
    } else {
      prodFiles.push(absolute);
    }
  }
  process.stderr.write(`  ${prodFiles.length} production files, ${testFiles.length} test files\n`);
  process.stderr.write(`  Phase 1: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 2: Observation collection (per-file, per-tool content-hash cache)
  phaseStart = performance.now();
  process.stderr.write('Phase 2: Collecting observations...\n');
  const allObservations: Observation[] = [];
  const testObsByFile = new Map<string, TestObservation[]>();
  let obsCount = 0;

  for (const fp of prodFiles) {
    try {
      const sf = getSourceFile(fp);
      const obs = runAllObservers(sf, fp, { noCache: args.noCache });
      allObservations.push(...obs);
      obsCount += obs.length;
    } catch (e) {
      /* v8 ignore start -- defensive: observer throw is rare and file-system-race-dependent */
      process.stderr.write(
        `  Warning: could not analyze ${path.relative(PROJECT_ROOT, fp)}: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      /* v8 ignore stop */
    }
  }

  for (const fp of testFiles) {
    try {
      const sf = getSourceFile(fp);
      const obs = runObservers(sf, fp, ['test-analysis'], { noCache: args.noCache });
      const testObs = obs.filter(
        (o): o is TestObservation =>
          o.kind === 'TEST_SUBJECT_IMPORT' ||
          o.kind === 'TEST_HELPER_IMPORT' ||
          o.kind === 'MOCK_DECLARATION' ||
          o.kind === 'SPY_DECLARATION' ||
          o.kind === 'MOCK_TARGET_RESOLVED' ||
          o.kind === 'ASSERTION_CALL' ||
          o.kind === 'RENDER_CALL' ||
          o.kind === 'PROVIDER_WRAPPER' ||
          o.kind === 'AFTER_EACH_BLOCK' ||
          o.kind === 'CLEANUP_CALL' ||
          o.kind === 'FIXTURE_IMPORT' ||
          o.kind === 'SHARED_MUTABLE_IMPORT' ||
          o.kind === 'DESCRIBE_BLOCK' ||
          o.kind === 'TEST_BLOCK' ||
          o.kind === 'PLAYWRIGHT_IMPORT' ||
          o.kind === 'TEST_HELPER_DELEGATION' ||
          o.kind === 'SEQUENTIAL_MOCK_RESPONSE' ||
          o.kind === 'TIMER_NEGATIVE_ASSERTION' ||
          o.kind === 'MOCK_INTERNAL' ||
          o.kind === 'MISSING_CLEANUP' ||
          o.kind === 'DATA_SOURCING_VIOLATION' ||
          o.kind === 'IMPLEMENTATION_ASSERTION',
      );
      const relPath = path.relative(PROJECT_ROOT, fp);
      testObsByFile.set(relPath, testObs);
      obsCount += obs.length;
    } catch {
      // Skip unanalyzable test files
    }
  }
  process.stderr.write(`  ${obsCount} observations collected\n`);
  process.stderr.write(`  Phase 2: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 3: Import graph (disk-cached)
  phaseStart = performance.now();
  process.stderr.write('Phase 3: Building import graph...\n');
  // Build graph from common ancestor of all target paths so multi-path
  // invocations (e.g., `ast-audit src/ui/ src/server/`) cover everything.
  const absolutePaths = args.paths.map(p => (path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p)));
  const graphTarget = absolutePaths.length === 1 ? absolutePaths[0] : commonAncestor(absolutePaths);
  const graph = buildDependencyGraph(graphTarget, { noCache: args.noCache });
  const importObs = extractImportObservations(graph);
  allObservations.push(...importObs.observations);
  process.stderr.write(
    `  ${importObs.observations.length} import observations, ${graph.circularDeps.length} circular deps\n`,
  );
  process.stderr.write(`  Phase 3: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 4: Interpreter chain
  phaseStart = performance.now();
  process.stderr.write('Phase 4: Running interpreters...\n');
  const groups = groupObservations(allObservations);

  // 4a: Independent interpreters
  const effectResult = interpretEffects(groups.effect);
  const templateResult = interpretTemplate(groups.jsx);
  const deadCodeResult = interpretDeadCode(groups.import, graph);
  const displayResult = interpretDisplayFormat(groups.numberFormat, groups.nullDisplay);
  const testCoverageResult = interpretTestCoverage(groups.testCoverage);

  // 4b: Hook assessment chain
  const hookResult = interpretHooks(groups.hook, astConfig);

  // 4c: Ownership depends on hooks
  const ownershipInputs: OwnershipInputs = {
    hookAssessments: hookResult.assessments,
    componentObservations: groups.component,
    hookObservations: groups.hook,
    sideEffectObservations: groups.sideEffect,
  };
  const ownershipResult = interpretOwnership(ownershipInputs, astConfig);

  // 4d: Test quality (per test file)
  const allTestQualityAssessments: ReturnType<typeof interpretTestQuality>['assessments'][number][] = [];
  for (const [, fileObs] of testObsByFile) {
    if (fileObs.length === 0) continue;
    const result = interpretTestQuality(fileObs, astConfig);
    allTestQualityAssessments.push(...result.assessments);
  }

  const totalAssessments =
    effectResult.assessments.length +
    templateResult.assessments.length +
    deadCodeResult.assessments.length +
    displayResult.assessments.length +
    testCoverageResult.assessments.length +
    hookResult.assessments.length +
    ownershipResult.assessments.length +
    allTestQualityAssessments.length;
  process.stderr.write(`  ${totalAssessments} assessments produced\n`);
  process.stderr.write(`  Phase 4: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 5: Finding mapping
  phaseStart = performance.now();
  process.stderr.write('Phase 5: Mapping findings...\n');
  const allFindings: Finding[] = [
    ...observationsToFindings(groups.all),
    ...effectAssessmentsToFindings(effectResult.assessments),
    ...ownershipAssessmentsToFindings(ownershipResult.assessments),
    ...deadCodeAssessmentsToFindings(deadCodeResult.assessments),
    ...templateAssessmentsToFindings(templateResult.assessments),
    ...testQualityAssessmentsToFindings(allTestQualityAssessments),
    ...testCoverageAssessmentsToFindings(testCoverageResult.assessments),
    ...displayFormatAssessmentsToFindings(displayResult.assessments),
  ];

  let findings = deduplicateAndSort(allFindings);
  process.stderr.write(`  Phase 5: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 6: Filters
  phaseStart = performance.now();
  findings = filterByPriority(findings, args.minPriority);
  if (args.track) {
    findings = findings.filter(f => f.track === args.track);
  }

  const cacheStats = getCacheStats();
  const durationMs = Date.now() - startTime;
  process.stderr.write(`  Phase 6: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);
  process.stderr.write(
    `  ${findings.length} findings (${durationMs}ms, cache: ${cacheStats.hits} hits / ${cacheStats.misses} misses)\n`,
  );

  // Phase 7: Output
  phaseStart = performance.now();
  if (args.json) {
    process.stdout.write(renderJson(findings) + '\n');
  } else {
    const meta: AuditMetadata = {
      timestamp: new Date().toISOString(),
      branch: gitBranch(),
      head: gitHead(),
      targetPaths: args.paths,
      filesScanned: prodFiles.length + testFiles.length,
      observationCount: obsCount,
      assessmentCount: totalAssessments,
      durationMs,
      cacheHits: cacheStats.hits,
      cacheMisses: cacheStats.misses,
    };

    const summary = renderMarkdownSummary(findings, meta);

    if (args.outputDir) {
      const outDir = path.isAbsolute(args.outputDir) ? args.outputDir : path.resolve(process.cwd(), args.outputDir);
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'findings.json'), renderJson(findings) + '\n');
      fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
      process.stderr.write(`Output written to ${outDir}/\n`);
    } else {
      process.stdout.write(summary);
    }
  }

  process.stderr.write(`  Phase 7: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);

  // Phase 8: Diff (optional)
  phaseStart = performance.now();
  if (args.diffDir) {
    const diffPath = path.isAbsolute(args.diffDir) ? args.diffDir : path.resolve(process.cwd(), args.diffDir);
    const prevFile = path.join(diffPath, 'findings.json');
    if (!fs.existsSync(prevFile)) {
      process.stderr.write(`Diff target not found: ${prevFile}\n`);
      process.exit(1);
    }
    const previous = JSON.parse(fs.readFileSync(prevFile, 'utf-8')) as Finding[];
    const diff = computeDiff(findings, previous);
    const diffMd = renderDiff(diff);

    if (args.outputDir) {
      const outDir = path.isAbsolute(args.outputDir) ? args.outputDir : path.resolve(process.cwd(), args.outputDir);
      fs.writeFileSync(path.join(outDir, 'diff.md'), diffMd);
      process.stderr.write(`Diff written to ${outDir}/diff.md\n`);
    } else {
      process.stdout.write('\n' + diffMd);
    }
  }
  process.stderr.write(`  Phase 8: ${(performance.now() - phaseStart).toFixed(0)}ms\n`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/* v8 ignore start */
const isDirectRun = process.argv[1]?.endsWith('ast-audit.ts') || process.argv[1]?.endsWith('ast-audit') || false;
if (isDirectRun) {
  main();
}
/* v8 ignore stop */
