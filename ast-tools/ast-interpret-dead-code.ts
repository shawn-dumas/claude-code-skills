import path from 'path';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { buildDependencyGraph, extractImportObservations } from './ast-imports';
import type { ImportObservation, ObservationRef, AssessmentResult, Assessment, DependencyGraph } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DeadCodeAssessmentKind =
  | 'DEAD_EXPORT' // export with 0 consumers, high confidence
  | 'POSSIBLY_DEAD_EXPORT' // export with 0 static consumers but may be dynamic
  | 'DEAD_BARREL_REEXPORT' // barrel re-exports something nobody imports
  | 'CIRCULAR_DEPENDENCY'; // part of a circular import chain

export type DeadCodeAssessment = Assessment<DeadCodeAssessmentKind>;

export type Fragility = 'fragile' | 'stable';

interface ClassificationResult {
  kind: DeadCodeAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
}

// ---------------------------------------------------------------------------
// Fragility analysis
// ---------------------------------------------------------------------------

/**
 * Count the number of consumer edges for each export in a file.
 * Returns a map from `file:exportName` to consumer file paths.
 */
function buildConsumerMap(edges: DependencyGraph['edges']): Map<string, string[]> {
  const consumerMap = new Map<string, string[]>();

  for (const edge of edges) {
    for (const specifier of edge.specifiers) {
      if (specifier === '*') continue;
      const key = `${edge.to}:${specifier.replace(/^\* as /, '')}`;
      const consumers = consumerMap.get(key) ?? [];
      consumers.push(edge.from);
      consumerMap.set(key, consumers);
    }
  }

  return consumerMap;
}

/**
 * Determine fragility for an export based on its consumer count.
 * An export with exactly 1 consumer is fragile (one removal from dead).
 */
function computeFragility(consumerCount: number): Fragility {
  return consumerCount === 1 ? 'fragile' : 'stable';
}

// ---------------------------------------------------------------------------
// Path patterns for dynamic consumer detection
// ---------------------------------------------------------------------------

/**
 * Directories that may have dynamic consumers not tracked by static analysis.
 * Exports from these directories get lower confidence.
 */
const DYNAMIC_CONSUMER_PATH_PATTERNS = ['pages/api/', 'server/'] as const;

// ---------------------------------------------------------------------------
// Observation helpers
// ---------------------------------------------------------------------------

/**
 * Build ObservationRef from an ImportObservation.
 */
function buildBasedOn(observation: ImportObservation): readonly ObservationRef[] {
  return [
    {
      kind: observation.kind,
      file: observation.file,
      line: observation.line,
    },
  ];
}

/**
 * Check if a file path suggests dynamic consumers (e.g., API routes).
 */
function mayHaveDynamicConsumers(filePath: string): boolean {
  return DYNAMIC_CONSUMER_PATH_PATTERNS.some(pattern => filePath.includes(pattern));
}

/**
 * Check if an export kind is a type-only export.
 */
function isTypeExport(exportKind: string | undefined): boolean {
  return exportKind === 'type' || exportKind === 'interface';
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/**
 * DEAD_EXPORT:
 * - DEAD_EXPORT_CANDIDATE observation with consumerCount: 0
 * - NOT isNextJsPage (Next.js pages have framework-consumed exports)
 * - NOT isBarrelReexported (barrel re-export -- check the barrel's consumers instead)
 * - Confidence: high if the export is not a type, medium for type exports
 */
function classifyDeadExport(observation: ImportObservation): ClassificationResult | null {
  if (observation.kind !== 'DEAD_EXPORT_CANDIDATE') {
    return null;
  }

  const evidence = observation.evidence;

  // Skip Next.js pages
  if (evidence.isNextJsPage) {
    return null;
  }

  // Skip barrel re-exports (they are pass-through)
  if (evidence.isBarrelReexported) {
    return null;
  }

  // Check if this might have dynamic consumers
  if (mayHaveDynamicConsumers(observation.file)) {
    return {
      kind: 'POSSIBLY_DEAD_EXPORT',
      confidence: 'low',
      rationale: [
        `export '${evidence.exportName}' has no static consumers`,
        `file is in a directory that may have dynamic consumers (fetch calls, etc.)`,
      ],
      isCandidate: false,
      requiresManualReview: true,
    };
  }

  // Regular dead export
  const isType = isTypeExport(evidence.exportKind);
  return {
    kind: 'DEAD_EXPORT',
    confidence: isType ? 'medium' : 'high',
    rationale: [
      `export '${evidence.exportName}' has no consumers`,
      isType ? 'type exports may have external consumers not tracked by static analysis' : '',
    ].filter(Boolean),
    isCandidate: false,
    requiresManualReview: false,
  };
}

/**
 * CIRCULAR_DEPENDENCY:
 * - CIRCULAR_DEPENDENCY observation
 * - Always requiresManualReview: true (cycles are sometimes intentional)
 * - Confidence: high (structural fact, not heuristic)
 * - isCandidate: false (it IS a cycle, no ambiguity about that)
 */
function classifyCircularDependency(observation: ImportObservation): ClassificationResult | null {
  if (observation.kind !== 'CIRCULAR_DEPENDENCY') {
    return null;
  }

  const cyclePath = observation.evidence.cyclePath ?? [];
  const cycleDescription =
    cyclePath.length > 3
      ? `${cyclePath.slice(0, 3).join(' -> ')} ... (${cyclePath.length} files)`
      : cyclePath.join(' -> ');

  return {
    kind: 'CIRCULAR_DEPENDENCY',
    confidence: 'high',
    rationale: [`circular import chain: ${cycleDescription}`],
    isCandidate: false,
    requiresManualReview: true,
  };
}

/**
 * DEAD_BARREL_REEXPORT:
 * - A REEXPORT_IMPORT where the re-exported symbol itself is dead
 * Note: This requires cross-referencing with dead exports, which we handle
 * during interpretation by checking if the re-export target is in the dead set.
 */
function classifyDeadBarrelReexport(
  observation: ImportObservation,
  deadExportNames: Set<string>,
): ClassificationResult | null {
  if (observation.kind !== 'REEXPORT_IMPORT') {
    return null;
  }

  const exportName = observation.evidence.exportName;
  if (!exportName || exportName.startsWith('* from ')) {
    // Skip namespace re-exports
    return null;
  }

  // Check if this re-export points to something dead
  // This is a simplified heuristic - in practice you'd trace the full chain
  if (deadExportNames.has(exportName)) {
    return {
      kind: 'DEAD_BARREL_REEXPORT',
      confidence: 'medium',
      rationale: [`barrel re-exports '${exportName}' which has no consumers`],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret import observations and produce dead code assessments.
 *
 * @param observations - Import observations from ast-imports
 * @param graph - Optional dependency graph for fragility analysis
 * @returns Assessment results
 */
export function interpretDeadCode(
  observations: readonly ImportObservation[],
  graph?: DependencyGraph,
): AssessmentResult<DeadCodeAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const assessments: DeadCodeAssessment[] = [];
  const consumerMap = graph ? buildConsumerMap(graph.edges) : null;

  // First pass: collect dead export names for barrel re-export detection
  const deadExportNames = new Set<string>();
  for (const observation of observations) {
    if (observation.kind === 'DEAD_EXPORT_CANDIDATE') {
      const name = observation.evidence.exportName;
      if (name) {
        deadExportNames.add(name);
      }
    }
  }

  // Second pass: classify each observation
  for (const observation of observations) {
    // Try dead export classification
    const deadResult = classifyDeadExport(observation);
    if (deadResult) {
      assessments.push({
        kind: deadResult.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.exportName,
        },
        confidence: deadResult.confidence,
        rationale: deadResult.rationale,
        basedOn: buildBasedOn(observation),
        isCandidate: deadResult.isCandidate,
        requiresManualReview: deadResult.requiresManualReview,
      });
      continue;
    }

    // Try circular dependency classification
    const circularResult = classifyCircularDependency(observation);
    if (circularResult) {
      assessments.push({
        kind: circularResult.kind,
        subject: {
          file: observation.file,
          line: observation.line,
        },
        confidence: circularResult.confidence,
        rationale: circularResult.rationale,
        basedOn: buildBasedOn(observation),
        isCandidate: circularResult.isCandidate,
        requiresManualReview: circularResult.requiresManualReview,
      });
      continue;
    }

    // Try dead barrel re-export classification
    const barrelResult = classifyDeadBarrelReexport(observation, deadExportNames);
    if (barrelResult) {
      assessments.push({
        kind: barrelResult.kind,
        subject: {
          file: observation.file,
          line: observation.line,
          symbol: observation.evidence.exportName,
        },
        confidence: barrelResult.confidence,
        rationale: barrelResult.rationale,
        basedOn: buildBasedOn(observation),
        isCandidate: barrelResult.isCandidate,
        requiresManualReview: barrelResult.requiresManualReview,
      });
      continue;
    }

    // Fragility analysis for live EXPORT_DECLARATION observations
    if (observation.kind === 'EXPORT_DECLARATION' && consumerMap) {
      const exportName = observation.evidence.exportName;
      if (exportName) {
        const key = `${observation.file}:${exportName}`;
        const consumers = consumerMap.get(key) ?? [];
        const fragility = computeFragility(consumers.length);
        if (fragility === 'fragile') {
          assessments.push({
            kind: 'DEAD_EXPORT',
            subject: {
              file: observation.file,
              line: observation.line,
              symbol: exportName,
            },
            confidence: 'low',
            rationale: [`[fragile] single consumer: ${consumers[0]}`],
            basedOn: buildBasedOn(observation),
            isCandidate: false,
            requiresManualReview: false,
          });
        }
      }
    }
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<DeadCodeAssessment>, filePath: string): string {
  const lines: string[] = [];
  lines.push(`Dead Code Assessments: ${filePath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No dead code issues found.');
    return lines.join('\n');
  }

  // Header
  lines.push(' Line | Symbol               | Assessment             | Confidence | Review');
  lines.push('------+----------------------+------------------------+------------+--------');

  for (const a of result.assessments) {
    const line = String(a.subject.line ?? '?').padStart(5);
    const symbol = (a.subject.symbol ?? '-').slice(0, 20).padEnd(20);
    const assessment = a.kind.padEnd(22);
    const confidence = a.confidence.padEnd(10);
    const review = a.requiresManualReview ? 'yes' : 'no ';
    lines.push(`${line} | ${symbol} | ${assessment} | ${confidence} | ${review}`);
  }

  lines.push('');
  lines.push('Rationale:');
  for (const a of result.assessments) {
    const symbol = a.subject.symbol ?? '-';
    lines.push(`  ${symbol}: ${a.rationale.join('; ')}`);
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
      'Usage: npx tsx scripts/AST/ast-interpret-dead-code.ts <file|dir> [--pretty]\n' +
        '\n' +
        'Interpret import observations and classify dead code issues.\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  DEAD_EXPORT            - Export with 0 consumers (safe to delete)\n' +
        '  POSSIBLY_DEAD_EXPORT   - Export may have dynamic consumers (manual review)\n' +
        '  DEAD_BARREL_REEXPORT   - Barrel re-exports something nobody imports\n' +
        '  CIRCULAR_DEPENDENCY    - Part of a circular import chain\n' +
        '\n' +
        '  <file|dir>  A .ts/.tsx file or directory to analyze\n' +
        '  --pretty    Format output as a human-readable table\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file path provided. Use --help for usage.');
  }

  const targetPath = args.paths[0];

  try {
    // Build dependency graph and extract observations
    const graph = buildDependencyGraph(targetPath);
    const observationResult = extractImportObservations(graph);
    const result = interpretDeadCode(observationResult.observations, graph);

    if (args.pretty) {
      const relativePath = path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, targetPath));
      process.stdout.write(formatPrettyOutput(result, relativePath) + '\n');
    } else {
      output(result, false);
    }
  } catch (e) {
    fatal(`Error analyzing ${targetPath}: ${e}`);
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-dead-code.ts') || process.argv[1].endsWith('ast-interpret-dead-code'));

if (isDirectRun) {
  main();
}
