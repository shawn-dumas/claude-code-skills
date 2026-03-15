import path from 'path';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { analyzeReactFile } from './ast-react-inventory';
import { astConfig, type AstConfig } from './ast-config';
import type { HookObservation, HookAssessment, HookAssessmentKind, ObservationRef, AssessmentResult } from './types';
import { cachedDirectory, hasNoCacheFlag, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClassificationResult {
  kind: HookAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
}

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

/**
 * Build ObservationRef from a HookObservation.
 */
function buildBasedOn(observation: HookObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

// ---------------------------------------------------------------------------
// Classification stages
// ---------------------------------------------------------------------------

/**
 * Stage 1: React builtins.
 * If evidence.isReactBuiltin === true -> LIKELY_STATE_HOOK, high confidence.
 */
function classifyReactBuiltin(observation: HookObservation, config: AstConfig): ClassificationResult | null {
  if (observation.evidence.isReactBuiltin) {
    return {
      kind: 'LIKELY_STATE_HOOK',
      confidence: 'high',
      rationale: [`React builtin hook '${observation.evidence.hookName}'`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Also check against config in case isReactBuiltin wasn't set
  if (config.react.builtinHooks.has(observation.evidence.hookName)) {
    return {
      kind: 'LIKELY_STATE_HOOK',
      confidence: 'high',
      rationale: [`React builtin hook '${observation.evidence.hookName}'`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  return null;
}

/**
 * Stage 2: Config name lists (ambient leaf hooks and scope suffix).
 */
function classifyByNameLists(observation: HookObservation, config: AstConfig): ClassificationResult | null {
  const hookName = observation.evidence.hookName;

  // Check ambient leaf hooks list
  if (config.hooks.ambientLeafHooks.has(hookName)) {
    return {
      kind: 'LIKELY_AMBIENT_HOOK',
      confidence: 'high',
      rationale: [`name '${hookName}' in ambient leaf hooks list`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Check scope hook suffix pattern (ends with 'Scope' and length > 8)
  if (hookName.endsWith(config.hooks.scopeHookSuffix) && hookName.length > 8) {
    return {
      kind: 'LIKELY_AMBIENT_HOOK',
      confidence: 'medium',
      rationale: [`name '${hookName}' ends with '${config.hooks.scopeHookSuffix}', matches scope hook pattern`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  return null;
}

/**
 * Stage 3: Import path classification.
 */
function classifyByImportPath(observation: HookObservation, config: AstConfig): ClassificationResult | null {
  const importSource = observation.evidence.importSource;

  if (!importSource) {
    return null;
  }

  // Check service hook path patterns
  for (const pattern of config.hooks.serviceHookPathPatterns) {
    if (importSource.includes(pattern)) {
      return {
        kind: 'LIKELY_SERVICE_HOOK',
        confidence: 'high',
        rationale: [`imports from '${importSource}' (matches service hook path pattern '${pattern}')`],
        isCandidate: true,
        requiresManualReview: false,
      };
    }
  }

  // Check context hook path patterns
  for (const pattern of config.hooks.contextHookPathPatterns) {
    if (importSource.includes(pattern)) {
      return {
        kind: 'LIKELY_CONTEXT_HOOK',
        confidence: 'high',
        rationale: [`imports from '${importSource}' (matches context hook path pattern '${pattern}')`],
        isCandidate: true,
        requiresManualReview: false,
      };
    }
  }

  // Check DOM utility path patterns
  for (const pattern of config.hooks.domUtilityPathPatterns) {
    if (importSource.includes(pattern)) {
      return {
        kind: 'LIKELY_AMBIENT_HOOK',
        confidence: 'high',
        rationale: [`imports from '${importSource}' (matches DOM utility path pattern '${pattern}')`],
        isCandidate: false,
        requiresManualReview: false,
      };
    }
  }

  // Check TanStack Query hooks
  const hookName = observation.evidence.hookName;
  if (config.hooks.tanstackQueryHooks.has(hookName)) {
    return {
      kind: 'LIKELY_SERVICE_HOOK',
      confidence: 'high',
      rationale: [`'${hookName}' is a TanStack Query hook`],
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  return null;
}

/**
 * Stage 4: Name heuristics (fallback when import path unavailable).
 */
function classifyByNameHeuristics(observation: HookObservation, config: AstConfig): ClassificationResult | null {
  const hookName = observation.evidence.hookName;
  const hasImportSource = Boolean(observation.evidence.importSource);

  // Check known context hooks by name
  if (config.hooks.knownContextHooks.has(hookName)) {
    return {
      kind: 'LIKELY_CONTEXT_HOOK',
      confidence: hasImportSource ? 'medium' : 'medium',
      rationale: [
        `name '${hookName}' in known context hooks list${hasImportSource ? '' : ', import path not resolved'}`,
      ],
      isCandidate: true,
      requiresManualReview: !hasImportSource,
    };
  }

  // Check TanStack Query hooks by name (fallback)
  if (config.hooks.tanstackQueryHooks.has(hookName)) {
    return {
      kind: 'LIKELY_SERVICE_HOOK',
      confidence: 'medium',
      rationale: [`name '${hookName}' is a TanStack Query hook${hasImportSource ? '' : ', import path not resolved'}`],
      isCandidate: true,
      requiresManualReview: !hasImportSource,
    };
  }

  return null;
}

/**
 * Stage 5: Unknown.
 * Everything else falls here.
 */
function classifyUnknown(observation: HookObservation): ClassificationResult {
  const reasons: string[] = [];

  if (!observation.evidence.importSource) {
    reasons.push('no import path available');
  }

  reasons.push('name does not match any known pattern');

  return {
    kind: 'UNKNOWN_HOOK',
    confidence: 'low',
    rationale: reasons,
    isCandidate: false,
    requiresManualReview: true,
  };
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret hook observations and produce assessments.
 *
 * Classification rules (5-stage cascade):
 * 1. React builtins -> LIKELY_STATE_HOOK
 * 2. Config name lists (ambient hooks, scope suffix) -> LIKELY_AMBIENT_HOOK
 * 3. Import path patterns -> LIKELY_SERVICE_HOOK | LIKELY_CONTEXT_HOOK | LIKELY_AMBIENT_HOOK
 * 4. Name heuristics -> LIKELY_CONTEXT_HOOK | LIKELY_SERVICE_HOOK (lower confidence)
 * 5. Unknown -> UNKNOWN_HOOK
 *
 * @param observations - Hook observations from ast-react-inventory
 * @param config - Repo convention config
 * @returns Assessment results
 */
export function interpretHooks(
  observations: readonly HookObservation[],
  config: AstConfig = astConfig,
): AssessmentResult<HookAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const assessments: HookAssessment[] = [];

  for (const observation of observations) {
    // Only process HOOK_CALL observations
    if (observation.kind !== 'HOOK_CALL') {
      continue;
    }

    // Try classification rules in priority order
    const result =
      classifyReactBuiltin(observation, config) ??
      classifyByNameLists(observation, config) ??
      classifyByImportPath(observation, config) ??
      classifyByNameHeuristics(observation, config) ??
      classifyUnknown(observation);

    // Detect near-boundary: count how many stages would produce a result
    const rationale = [...result.rationale];
    if (result.kind === 'UNKNOWN_HOOK') {
      rationale.push('no classification pattern matched');
    } else {
      // Check if multiple stages would match (ambiguous classification)
      const alternateResults: string[] = [];
      if (classifyByNameLists(observation, config)) alternateResults.push('name-list');
      if (classifyByImportPath(observation, config)) alternateResults.push('import-path');
      if (classifyByNameHeuristics(observation, config)) alternateResults.push('name-heuristic');
      if (alternateResults.length > 1) {
        rationale.push(`[near-boundary] multiple patterns matched: ${alternateResults.join(', ')}`);
      }
    }

    assessments.push({
      kind: result.kind,
      subject: {
        file: observation.file,
        line: observation.line,
        symbol: observation.evidence.hookName,
      },
      confidence: result.confidence,
      rationale,
      basedOn: buildBasedOn(observation),
      isCandidate: result.isCandidate,
      requiresManualReview: result.requiresManualReview,
    });
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<HookAssessment>, filePath: string): string {
  const lines: string[] = [];
  lines.push(`Hook Assessments: ${filePath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No hook calls found.');
    return lines.join('\n');
  }

  // Header
  lines.push(' Line | Hook                 | Assessment          | Confidence | Rationale');
  lines.push('------+----------------------+---------------------+------------+--------------------------');

  for (const a of result.assessments) {
    const line = String(a.subject.line ?? '?').padStart(5);
    const hook = (a.subject.symbol ?? 'unknown').slice(0, 20).padEnd(20);
    const assessment = a.kind.padEnd(19);
    const confidence = a.confidence.padEnd(10);
    const rationale = a.rationale.join('; ').slice(0, 40);
    lines.push(`${line} | ${hook} | ${assessment} | ${confidence} | ${rationale}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Directory analysis (with caching)
// ---------------------------------------------------------------------------

/**
 * Analyze all files in a directory and collect hook assessments.
 * This is the cached unit of work for directory-level analysis.
 */
function analyzeDirectory(filePaths: string[], pretty: boolean): AssessmentResult<HookAssessment> {
  const allAssessments: HookAssessment[] = [];

  for (const filePath of filePaths) {
    try {
      const inventory = analyzeReactFile(filePath);
      if (inventory.hookObservations.length > 0) {
        const result = interpretHooks(inventory.hookObservations, astConfig);
        allAssessments.push(...result.assessments);
      }
    } catch (e) {
      // Skip files that cannot be parsed
      if (!pretty) {
        console.error(`Warning: could not analyze ${filePath}: ${e}`);
      }
    }
  }

  return { assessments: allAssessments };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);
  const noCache = hasNoCacheFlag(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-hooks.ts <file|dir> [--pretty] [--no-cache]\n' +
        '\n' +
        'Interpret hook call observations and classify them.\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  LIKELY_SERVICE_HOOK  - Data-fetching hook (TanStack Query, services/hooks/)\n' +
        '  LIKELY_CONTEXT_HOOK  - Context hook (useAuthState, providers/)\n' +
        '  LIKELY_AMBIENT_HOOK  - Ambient UI hook (useBreakpoints, shared/hooks/)\n' +
        '  LIKELY_STATE_HOOK    - React builtin (useState, useMemo, etc.)\n' +
        '  UNKNOWN_HOOK         - Cannot classify\n' +
        '\n' +
        '  <file|dir>   A .tsx/.ts file or directory to analyze\n' +
        '  --pretty     Format output as a human-readable table\n' +
        '  --no-cache   Bypass cache and recompute (also refreshes cache)\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  // Collect all files to analyze
  const filePaths: string[] = [];
  let isDirectory = false;
  let dirPath = '';

  for (const p of args.paths) {
    const fs = require('fs');
    const absolute = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      isDirectory = true;
      dirPath = absolute;
      // Find all .tsx files in directory
      const glob = require('glob');
      const files = glob.sync('**/*.tsx', { cwd: absolute, absolute: true });
      filePaths.push(...files);
    } else {
      filePaths.push(absolute);
    }
  }

  if (filePaths.length === 0) {
    fatal('No .tsx files found.');
  }

  // Use directory-level caching if analyzing a directory
  let finalResult: AssessmentResult<HookAssessment>;

  if (isDirectory && filePaths.length > 1) {
    finalResult = cachedDirectory(
      'interpret-hooks',
      dirPath,
      filePaths,
      () => analyzeDirectory(filePaths, args.pretty),
      { noCache },
    );
  } else {
    // Single file - no directory caching benefit
    finalResult = analyzeDirectory(filePaths, args.pretty);
  }

  if (args.pretty) {
    const relativePaths = filePaths.map(f => path.relative(PROJECT_ROOT, f)).join(', ');
    process.stdout.write(formatPrettyOutput(finalResult, relativePaths) + '\n');
  } else {
    output(finalResult, false);
  }

  // Output cache stats
  const stats = getCacheStats();
  process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-hooks.ts') || process.argv[1].endsWith('ast-interpret-hooks'));

if (isDirectRun) {
  main();
}
