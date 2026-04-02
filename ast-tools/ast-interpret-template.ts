import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { extractJsxObservations } from './ast-jsx-analysis';
import { computeBoundaryConfidence, getFilesInDirectory } from './shared';
import { astConfig } from './ast-config';
import type { JsxObservation, ObservationRef, AssessmentResult, Assessment } from './types';
import { formatAssessmentTable } from './assessment-formatter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TemplateAssessmentKind =
  | 'EXTRACTION_CANDIDATE' // pattern should become a shared component
  | 'COMPLEXITY_HOTSPOT'; // return block is too complex, needs flattening

export type TemplateAssessment = Assessment<TemplateAssessmentKind>;

interface GroupedObservations {
  componentName: string;
  file: string;
  observations: JsxObservation[];
  returnBlockObs: JsxObservation | null;
  returnLineCount: number;
  ternaryChainCount: number;
  maxTernaryDepth: number;
  hasIife: boolean;
  maxHandlerStatementCount: number;
  distinctObservationKinds: Set<string>;
}

interface ClassificationResult {
  kind: TemplateAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
  basedOnKinds: string[];
}

// ---------------------------------------------------------------------------
// Configuration thresholds
// ---------------------------------------------------------------------------

const THRESHOLDS = {
  returnLineCountHigh: 150,
  returnLineCountMedium: 100,
  ternaryDepthForExtraction: 2,
  multipleDeepTernaryCounts: 2,
  distinctKindsForHotspot: 3,
  handlerStatementCountForHotspot: 4,
} as const;

// ---------------------------------------------------------------------------
// Observation grouping
// ---------------------------------------------------------------------------

/**
 * Group observations by component so each component is assessed once.
 */
function groupObservationsByComponent(observations: readonly JsxObservation[]): GroupedObservations[] {
  const byComponent = new Map<string, JsxObservation[]>();

  for (const obs of observations) {
    const key = `${obs.file}:${obs.evidence.componentName}`;
    if (!byComponent.has(key)) {
      byComponent.set(key, []);
    }
    byComponent.get(key)!.push(obs);
  }

  const groups: GroupedObservations[] = [];

  for (const [_key, obs] of byComponent.entries()) {
    const componentName = obs[0].evidence.componentName;
    const file = obs[0].file;

    const returnBlockObs = obs.find(o => o.kind === 'JSX_RETURN_BLOCK') ?? null;
    const returnLineCount = returnBlockObs?.evidence.returnLineCount ?? 0;

    const ternaryObs = obs.filter(o => o.kind === 'JSX_TERNARY_CHAIN');
    const ternaryChainCount = ternaryObs.length;
    const maxTernaryDepth = Math.max(0, ...ternaryObs.map(o => o.evidence.depth ?? 0));

    const hasIife = obs.some(o => o.kind === 'JSX_IIFE');

    const handlerObs = obs.filter(o => o.kind === 'JSX_INLINE_HANDLER');
    const maxHandlerStatementCount = Math.max(0, ...handlerObs.map(o => o.evidence.statementCount ?? 0));

    const distinctKinds = new Set(obs.map(o => o.kind));

    groups.push({
      componentName,
      file,
      observations: obs,
      returnBlockObs,
      returnLineCount,
      ternaryChainCount,
      maxTernaryDepth,
      hasIife,
      maxHandlerStatementCount,
      distinctObservationKinds: distinctKinds,
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/**
 * Build ObservationRef array from observations for basedOn field.
 */
function buildBasedOn(observations: JsxObservation[], filterKinds?: string[]): readonly ObservationRef[] {
  const refs: ObservationRef[] = [];
  for (const obs of observations) {
    if (!filterKinds || filterKinds.includes(obs.kind)) {
      refs.push({
        kind: obs.kind,
        file: obs.file,
        line: obs.line,
      });
    }
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/**
 * EXTRACTION_CANDIDATE:
 * - returnLineCount > 100 (from astConfig thresholds)
 * - OR multiple JSX_TERNARY_CHAIN with depth >= 2 in the same return
 * - OR JSX_IIFE present (always a candidate for extraction)
 */
function classifyExtractionCandidate(group: GroupedObservations): ClassificationResult | null {
  const rationale: string[] = [];
  const basedOnKinds: string[] = [];

  // Check return line count
  if (group.returnLineCount > THRESHOLDS.returnLineCountMedium) {
    rationale.push(`return block has ${group.returnLineCount} lines (threshold: ${THRESHOLDS.returnLineCountMedium})`);
    basedOnKinds.push('JSX_RETURN_BLOCK');
  }

  // Check multiple deep ternary chains
  const deepTernaryObs = group.observations.filter(
    o => o.kind === 'JSX_TERNARY_CHAIN' && (o.evidence.depth ?? 0) >= THRESHOLDS.ternaryDepthForExtraction,
  );
  if (deepTernaryObs.length >= THRESHOLDS.multipleDeepTernaryCounts) {
    rationale.push(`${deepTernaryObs.length} deep ternary chains (depth >= ${THRESHOLDS.ternaryDepthForExtraction})`);
    basedOnKinds.push('JSX_TERNARY_CHAIN');
  }

  // Check for IIFE
  if (group.hasIife) {
    rationale.push('contains IIFE in JSX (always extract)');
    basedOnKinds.push('JSX_IIFE');
  }

  if (rationale.length === 0) {
    return null;
  }

  // Confidence: high if returnLineCount > 150, medium if 100-150
  const confidence =
    group.returnLineCount > THRESHOLDS.returnLineCountHigh ? 'high' : group.hasIife ? 'high' : 'medium';

  return {
    kind: 'EXTRACTION_CANDIDATE',
    confidence,
    rationale,
    isCandidate: true,
    requiresManualReview: false,
    basedOnKinds,
  };
}

/**
 * Check whether a component has at least one "substantive" JSX observation.
 * Trivial instances (depth-1 ternary, 1-statement handler, 1-2 condition guard,
 * single-method transform) are common in clean components and should not
 * contribute to hotspot detection when variety is at the minimum threshold.
 *
 * Severity floors align with ast-config.ts violation thresholds so that
 * a "substantive" instance is one that would also be a standalone violation.
 */
function hasSubstantiveObservation(observations: JsxObservation[]): boolean {
  for (const obs of observations) {
    switch (obs.kind) {
      case 'JSX_TERNARY_CHAIN':
        if ((obs.evidence.depth ?? 0) >= 2) return true;
        break;
      case 'JSX_INLINE_HANDLER':
        if ((obs.evidence.statementCount ?? 0) >= 2) return true;
        break;
      case 'JSX_GUARD_CHAIN':
        if ((obs.evidence.conditionCount ?? 0) >= 3) return true;
        break;
      case 'JSX_TRANSFORM_CHAIN':
        if ((obs.evidence.chainLength ?? 0) >= 2) return true;
        break;
      case 'JSX_IIFE':
      case 'JSX_INLINE_STYLE':
      case 'JSX_COMPLEX_CLASSNAME':
        return true;
    }
  }
  return false;
}

/**
 * COMPLEXITY_HOTSPOT:
 * - 4+ distinct JSX observation kinds in the same component
 * - OR 3 distinct kinds where at least one is substantive (above severity floor)
 * - OR JSX_INLINE_HANDLER with statementCount >= 4
 */
function classifyComplexityHotspot(group: GroupedObservations): ClassificationResult | null {
  const rationale: string[] = [];
  const basedOnKinds: string[] = [];

  // Check distinct observation kinds (exclude JSX_RETURN_BLOCK as it's metadata)
  const meaningfulKinds = new Set(group.distinctObservationKinds);
  meaningfulKinds.delete('JSX_RETURN_BLOCK');

  if (meaningfulKinds.size >= THRESHOLDS.distinctKindsForHotspot) {
    // At the minimum threshold (3 kinds), require at least one substantive
    // instance. This filters trivial-only components (depth-1 ternary +
    // 1-statement handler + simple guard) while preserving sensitivity for
    // real hotspots. At 4+ kinds, the variety alone signals complexity.
    const needsSeverityCheck = meaningfulKinds.size === THRESHOLDS.distinctKindsForHotspot;
    if (!needsSeverityCheck || hasSubstantiveObservation(group.observations)) {
      rationale.push(`${meaningfulKinds.size} distinct complexity patterns: ${Array.from(meaningfulKinds).join(', ')}`);
      basedOnKinds.push(...Array.from(meaningfulKinds));
    }
  }

  // Check handler statement count
  if (group.maxHandlerStatementCount >= THRESHOLDS.handlerStatementCountForHotspot) {
    rationale.push(
      `inline handler with ${group.maxHandlerStatementCount} statements (threshold: ${THRESHOLDS.handlerStatementCountForHotspot})`,
    );
    basedOnKinds.push('JSX_INLINE_HANDLER');
  }

  if (rationale.length === 0) {
    return null;
  }

  return {
    kind: 'COMPLEXITY_HOTSPOT',
    confidence: 'medium',
    rationale,
    isCandidate: true,
    requiresManualReview: false,
    basedOnKinds,
  };
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret JSX observations and produce assessments.
 *
 * The interpreter emits assessments only when it finds a problem. Absence of
 * any assessment for a component means it is within thresholds.
 *
 * @param observations - JSX observations from ast-jsx-analysis
 * @returns Assessment results
 */
export function interpretTemplate(observations: readonly JsxObservation[]): AssessmentResult<TemplateAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const groups = groupObservationsByComponent(observations);
  const assessments: TemplateAssessment[] = [];

  const jsxThresholds = astConfig.jsx.thresholds;

  for (const group of groups) {
    // Try classification rules in priority order
    // Only emit if a problem is found
    const extractionResult = classifyExtractionCandidate(group);
    if (extractionResult) {
      const rationale = [...extractionResult.rationale];
      // Check if return line count is near a threshold boundary
      if (group.returnLineCount > 0) {
        const bc = computeBoundaryConfidence(group.returnLineCount, [
          THRESHOLDS.returnLineCountMedium,
          THRESHOLDS.returnLineCountHigh,
        ]);
        if (bc === 'low') {
          rationale.push(
            `[near-boundary] returnLineCount ${group.returnLineCount}, thresholds ${THRESHOLDS.returnLineCountMedium}/${THRESHOLDS.returnLineCountHigh}`,
          );
        }
      }

      assessments.push({
        kind: extractionResult.kind,
        subject: {
          file: group.file,
          line: group.returnBlockObs?.line ?? group.observations[0].line,
          symbol: group.componentName,
        },
        confidence: extractionResult.confidence,
        rationale,
        basedOn: buildBasedOn(group.observations, extractionResult.basedOnKinds),
        isCandidate: extractionResult.isCandidate,
        requiresManualReview: extractionResult.requiresManualReview,
      });
    }

    const hotspotResult = classifyComplexityHotspot(group);
    if (hotspotResult) {
      const rationale = [...hotspotResult.rationale];
      // Check if metrics are near boundary thresholds
      if (group.maxTernaryDepth > 0) {
        const bc = computeBoundaryConfidence(group.maxTernaryDepth, [jsxThresholds.chainedTernaryDepth]);
        if (bc === 'low') {
          rationale.push(
            `[near-boundary] ternaryDepth ${group.maxTernaryDepth}, threshold ${jsxThresholds.chainedTernaryDepth}`,
          );
        }
      }
      if (group.maxHandlerStatementCount > 0) {
        const bc = computeBoundaryConfidence(group.maxHandlerStatementCount, [
          THRESHOLDS.handlerStatementCountForHotspot,
        ]);
        if (bc === 'low') {
          rationale.push(
            `[near-boundary] handlerStatements ${group.maxHandlerStatementCount}, threshold ${THRESHOLDS.handlerStatementCountForHotspot}`,
          );
        }
      }

      assessments.push({
        kind: hotspotResult.kind,
        subject: {
          file: group.file,
          line: group.observations[0].line,
          symbol: group.componentName,
        },
        confidence: hotspotResult.confidence,
        rationale,
        basedOn: buildBasedOn(group.observations, hotspotResult.basedOnKinds),
        isCandidate: hotspotResult.isCandidate,
        requiresManualReview: hotspotResult.requiresManualReview,
      });
    }
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<TemplateAssessment>, filePath: string): string {
  return formatAssessmentTable(
    {
      title: `Template Assessments: ${filePath}`,
      emptyMessage: 'No template complexity issues found.',
      columns: [
        { header: 'Line', width: 5, align: 'right', extract: a => String(a.subject.line ?? '?') },
        { header: 'Component', width: 20, extract: a => a.subject.symbol ?? 'unknown' },
        { header: 'Assessment', width: 20, extract: a => a.kind },
        { header: 'Confidence', width: 10, extract: a => a.confidence },
        { header: 'Rationale', width: 50, extract: a => a.rationale.join('; ') },
      ],
    },
    result.assessments,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-template.ts <file|dir> [--pretty]\n' +
        '\n' +
        'Interpret JSX template observations and classify complexity issues.\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  EXTRACTION_CANDIDATE  - Component should be broken into smaller components\n' +
        '  COMPLEXITY_HOTSPOT    - Template is too complex, needs flattening\n' +
        '\n' +
        '  <file|dir>  A .tsx file or directory to analyze\n' +
        '  --pretty    Format output as a human-readable table\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  // Collect all files to analyze
  const filePaths: string[] = [];
  for (const p of args.paths) {
    const absolute = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      // Find all .tsx files in directory
      const files = getFilesInDirectory(absolute);
      filePaths.push(...files);
    } else {
      filePaths.push(absolute);
    }
  }

  if (filePaths.length === 0) {
    fatal('No .tsx files found.');
  }

  // Analyze all files and collect assessments
  const allAssessments: TemplateAssessment[] = [];

  for (const filePath of filePaths) {
    try {
      const observations = extractJsxObservations(filePath);
      if (observations.length > 0) {
        const result = interpretTemplate(observations);
        allAssessments.push(...result.assessments);
      }
    } catch (e) {
      // Skip files that cannot be parsed
      if (!args.pretty) {
        console.error(`Warning: could not analyze ${filePath}: ${String(e)}`);
      }
    }
  }

  const finalResult: AssessmentResult<TemplateAssessment> = { assessments: allAssessments };

  if (args.pretty) {
    const relativePaths = filePaths.map(f => path.relative(PROJECT_ROOT, f)).join(', ');
    process.stdout.write(formatPrettyOutput(finalResult, relativePaths) + '\n');
  } else {
    output(finalResult, false);
  }
}

// Run CLI when executed directly
/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-template.ts') || process.argv[1].endsWith('ast-interpret-template'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
