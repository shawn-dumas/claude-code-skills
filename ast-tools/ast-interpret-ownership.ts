import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { getFilesInDirectory } from './shared';
import { analyzeReactFile } from './ast-react-inventory';
import { interpretHooks } from './ast-interpret-hooks';
import { astConfig, type AstConfig } from './ast-config';
import type {
  HookAssessment,
  ComponentObservation,
  HookObservation,
  SideEffectObservation,
  DataLayerObservation,
  ImportObservation,
  OwnershipAssessment,
  OwnershipAssessmentKind,
  ObservationRef,
  AssessmentResult,
} from './types';
import { cachedDirectory, hasNoCacheFlag, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OwnershipInputs {
  hookAssessments: readonly HookAssessment[];
  componentObservations: readonly ComponentObservation[];
  hookObservations: readonly HookObservation[];
  sideEffectObservations?: readonly SideEffectObservation[];
  dataLayerObservations?: readonly DataLayerObservation[];
  importObservations?: readonly ImportObservation[];
}

interface ComponentContext {
  name: string;
  file: string;
  line: number;
  hasProps: boolean;
  propCount: number;
  callbackPropCount: number;
  hookAssessments: HookAssessment[];
  hookObservations: HookObservation[];
  sideEffects: SideEffectObservation[];
}

interface ContainerSignals {
  serviceHookCount: number;
  contextHookCount: number;
  routerHookCount: number;
  toastCallCount: number;
  hasContainerSuffix: boolean;
  inContainerDirectory: boolean;
}

interface LeafSignals {
  hasProps: boolean;
  noContainerSuffix: boolean;
  notInContainerDirectory: boolean;
  noContainerHooks: boolean;
}

interface ClassificationResult {
  kind: OwnershipAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildBasedOn(
  componentObs: ComponentObservation,
  hookAssessments: HookAssessment[],
): readonly ObservationRef[] {
  const refs: ObservationRef[] = [
    {
      kind: componentObs.kind,
      file: componentObs.file,
      line: componentObs.line,
    },
  ];

  for (const ha of hookAssessments) {
    refs.push({
      kind: ha.kind,
      file: ha.subject.file,
      line: ha.subject.line ?? 0,
    });
  }

  return refs;
}

function getComponentName(obs: ComponentObservation): string {
  return obs.evidence.componentName ?? 'unknown';
}

function isRouterHook(hookName: string, config: AstConfig): boolean {
  return config.ownership.routerHooks.has(hookName);
}

// ---------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------

function extractContainerSignals(ctx: ComponentContext, config: AstConfig): ContainerSignals {
  let serviceHookCount = 0;
  let contextHookCount = 0;
  let routerHookCount = 0;
  let toastCallCount = 0;

  // Count service and context hooks from assessments
  for (const ha of ctx.hookAssessments) {
    if (ha.kind === 'LIKELY_SERVICE_HOOK') {
      serviceHookCount++;
    } else if (ha.kind === 'LIKELY_CONTEXT_HOOK') {
      contextHookCount++;
    }
  }

  // Count router hooks from observations
  for (const ho of ctx.hookObservations) {
    if (ho.kind === 'HOOK_CALL' && isRouterHook(ho.evidence.hookName, config)) {
      routerHookCount++;
    }
  }

  // Count toast calls
  for (const se of ctx.sideEffects) {
    if (se.kind === 'TOAST_CALL') {
      toastCallCount++;
    }
  }

  // Check naming conventions
  const hasContainerSuffix = config.ownership.containerSuffixes.some(suffix => ctx.name.endsWith(suffix));

  const inContainerDirectory = config.ownership.containerDirectories.some(dir => ctx.file.includes(dir));

  return {
    serviceHookCount,
    contextHookCount,
    routerHookCount,
    toastCallCount,
    hasContainerSuffix,
    inContainerDirectory,
  };
}

function countContainerSignals(signals: ContainerSignals): number {
  let count = 0;

  if (signals.serviceHookCount > 0) count++;
  if (signals.contextHookCount > 0) count++;
  if (signals.routerHookCount > 0) count++;
  if (signals.toastCallCount > 0) count++;
  if (signals.hasContainerSuffix) count++;
  if (signals.inContainerDirectory) count++;

  // Multiple service hooks indicate orchestration regardless of naming/directory
  if (signals.serviceHookCount >= 2) count++;

  return count;
}

function extractLeafSignals(ctx: ComponentContext, containerSignals: ContainerSignals, config: AstConfig): LeafSignals {
  const hasContainerSuffix = config.ownership.containerSuffixes.some(suffix => ctx.name.endsWith(suffix));

  const inContainerDirectory = config.ownership.containerDirectories.some(dir => ctx.file.includes(dir));

  // A component has no "container hooks" if it lacks service/context hooks and router hooks
  const noContainerHooks =
    containerSignals.serviceHookCount === 0 &&
    containerSignals.contextHookCount === 0 &&
    containerSignals.routerHookCount === 0 &&
    containerSignals.toastCallCount === 0;

  return {
    hasProps: ctx.hasProps,
    noContainerSuffix: !hasContainerSuffix,
    notInContainerDirectory: !inContainerDirectory,
    noContainerHooks,
  };
}

function hasDisallowedHook(ctx: ComponentContext): HookAssessment | null {
  // Look for service or context hooks with medium or higher confidence
  for (const ha of ctx.hookAssessments) {
    if (
      (ha.kind === 'LIKELY_SERVICE_HOOK' || ha.kind === 'LIKELY_CONTEXT_HOOK') &&
      (ha.confidence === 'high' || ha.confidence === 'medium')
    ) {
      return ha;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

function matchesLayoutException(name: string, exceptions: ReadonlySet<string>): string | null {
  if (exceptions.has(name)) return name;
  for (const exception of exceptions) {
    if (name.endsWith(exception)) return exception;
  }
  return null;
}

function classifyLayoutShell(ctx: ComponentContext, config: AstConfig): ClassificationResult | null {
  const matchedException = matchesLayoutException(ctx.name, config.ownership.layoutExceptions);
  if (matchedException) {
    const rationale =
      matchedException === ctx.name
        ? `'${ctx.name}' is a documented layout exception`
        : `'${ctx.name}' matches layout exception '${matchedException}' (suffix match)`;
    return {
      kind: 'LAYOUT_SHELL',
      confidence: 'high',
      rationale: [rationale],
      isCandidate: false,
      requiresManualReview: false,
    };
  }
  return null;
}

function classifyContainer(ctx: ComponentContext, containerSignals: ContainerSignals): ClassificationResult | null {
  const signalCount = countContainerSignals(containerSignals);

  if (signalCount >= 3) {
    const reasons: string[] = [];
    if (containerSignals.serviceHookCount > 0) {
      reasons.push(`${containerSignals.serviceHookCount} service hook(s)`);
    }
    if (containerSignals.contextHookCount > 0) {
      reasons.push(`${containerSignals.contextHookCount} context hook(s)`);
    }
    if (containerSignals.routerHookCount > 0) {
      reasons.push(`router hook`);
    }
    if (containerSignals.toastCallCount > 0) {
      reasons.push(`toast call`);
    }
    if (containerSignals.hasContainerSuffix) {
      reasons.push(`name ends with Container`);
    }
    if (containerSignals.inContainerDirectory) {
      reasons.push(`in containers/ directory`);
    }

    return {
      kind: 'CONTAINER',
      confidence: 'high',
      rationale: reasons,
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  if (signalCount === 2) {
    const reasons: string[] = [];
    if (containerSignals.serviceHookCount > 0) {
      reasons.push(`${containerSignals.serviceHookCount} service hook(s)`);
    }
    if (containerSignals.contextHookCount > 0) {
      reasons.push(`${containerSignals.contextHookCount} context hook(s)`);
    }
    if (containerSignals.routerHookCount > 0) {
      reasons.push(`router hook`);
    }
    if (containerSignals.toastCallCount > 0) {
      reasons.push(`toast call`);
    }
    if (containerSignals.hasContainerSuffix) {
      reasons.push(`name ends with Container`);
    }
    if (containerSignals.inContainerDirectory) {
      reasons.push(`in containers/ directory`);
    }

    return {
      kind: 'CONTAINER',
      confidence: 'medium',
      rationale: reasons,
      isCandidate: true,
      requiresManualReview: false,
    };
  }

  // 1 signal alone does NOT produce a low-confidence CONTAINER
  // It produces AMBIGUOUS (handled later)
  return null;
}

function classifyDdauComponent(ctx: ComponentContext, leafSignals: LeafSignals): ClassificationResult | null {
  // A DDAU component has props, no service/context hooks, and no side effects
  const hasNoSideEffects = ctx.sideEffects.length === 0;

  if (leafSignals.hasProps && leafSignals.noContainerHooks && hasNoSideEffects) {
    return {
      kind: 'DDAU_COMPONENT',
      confidence: 'high',
      rationale: [`has ${ctx.propCount} prop(s)`, 'no service/context hooks', 'no side effects'],
      isCandidate: false,
      requiresManualReview: false,
    };
  }

  // Medium confidence: has props but has ambient hooks with side effects
  if (leafSignals.hasProps && leafSignals.noContainerHooks && !hasNoSideEffects) {
    return {
      kind: 'DDAU_COMPONENT',
      confidence: 'medium',
      rationale: [
        `has ${ctx.propCount} prop(s)`,
        'no service/context hooks',
        `has ${ctx.sideEffects.length} side effect(s) (ambient hook usage)`,
      ],
      isCandidate: false,
      requiresManualReview: true,
    };
  }

  return null;
}

function classifyLeafViolation(ctx: ComponentContext, leafSignals: LeafSignals): ClassificationResult | null {
  // LEAF_VIOLATION requires affirmative evidence on BOTH sides
  const disallowedHook = hasDisallowedHook(ctx);

  if (!disallowedHook) {
    return null;
  }

  // Leaf evidence: has props, no container suffix, not in container directory
  const hasLeafEvidence = leafSignals.hasProps && leafSignals.noContainerSuffix && leafSignals.notInContainerDirectory;

  if (!hasLeafEvidence) {
    // Only disallowed hook without leaf evidence -> AMBIGUOUS (handled later)
    return null;
  }

  // Both sides have affirmative evidence -> LEAF_VIOLATION
  return {
    kind: 'LEAF_VIOLATION',
    confidence: disallowedHook.confidence,
    rationale: [
      `has props (leaf evidence)`,
      `not named as container`,
      `not in containers/ directory`,
      `calls ${disallowedHook.subject.symbol} (${disallowedHook.kind}, ${disallowedHook.confidence} confidence)`,
    ],
    isCandidate: true,
    requiresManualReview: true,
  };
}

function classifyAmbiguous(
  ctx: ComponentContext,
  containerSignals: ContainerSignals,
  leafSignals: LeafSignals,
): ClassificationResult {
  const reasons: string[] = [];

  const signalCount = countContainerSignals(containerSignals);

  if (signalCount === 1) {
    reasons.push('exactly 1 container signal (insufficient for CONTAINER)');
  }

  const disallowedHook = hasDisallowedHook(ctx);
  if (disallowedHook && !leafSignals.hasProps) {
    reasons.push(`has disallowed hook ${disallowedHook.subject.symbol} but no prop evidence`);
  }

  if (
    containerSignals.serviceHookCount > 0 &&
    ctx.hasProps &&
    !containerSignals.hasContainerSuffix &&
    !containerSignals.inContainerDirectory
  ) {
    reasons.push('has service hooks AND props with no naming/directory evidence');
  }

  if (reasons.length === 0) {
    reasons.push('mixed signals, cannot determine ownership');
  }

  return {
    kind: 'AMBIGUOUS',
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
 * Interpret ownership for components based on hook assessments and observations.
 *
 * Classification rules:
 * 1. LAYOUT_SHELL: component name in documented exceptions list
 * 2. CONTAINER: 2+ container signals (service hooks, context hooks, router, toast, naming,
 *    or multiple service hooks -- 2+ LIKELY_SERVICE_HOOK counts as an additional signal)
 * 3. DDAU_COMPONENT: has props, no service/context hooks, no side effects
 * 4. LEAF_VIOLATION: has leaf evidence AND disallowed hooks (both sides required)
 * 5. AMBIGUOUS: insufficient evidence to commit to any classification
 *
 * @param inputs - Hook assessments and observations from AST tools
 * @param config - Repo convention config
 * @returns Assessment results
 */
export function interpretOwnership(
  inputs: OwnershipInputs,
  config: AstConfig = astConfig,
): AssessmentResult<OwnershipAssessment> {
  const { hookAssessments, componentObservations, hookObservations, sideEffectObservations = [] } = inputs;

  if (componentObservations.length === 0) {
    return { assessments: [] };
  }

  // Group observations by component
  const componentDeclarations = componentObservations.filter(o => o.kind === 'COMPONENT_DECLARATION');

  if (componentDeclarations.length === 0) {
    return { assessments: [] };
  }

  const assessments: OwnershipAssessment[] = [];

  for (const componentObs of componentDeclarations) {
    const componentName = getComponentName(componentObs);
    const componentFile = componentObs.file;
    const componentLine = componentObs.line;

    // Get props for this component
    const propFields = componentObservations.filter(
      o => o.kind === 'PROP_FIELD' && o.file === componentFile && o.evidence.componentName === componentName,
    );

    // Get hook observations for this component
    const componentHookObs = hookObservations.filter(
      o => o.kind === 'HOOK_CALL' && o.file === componentFile && o.evidence.parentFunction === componentName,
    );

    // Get hook assessments for this component
    const componentHookAssessments = hookAssessments.filter(
      ha =>
        ha.subject.file === componentFile &&
        componentHookObs.some(ho => ho.line === ha.subject.line && ho.evidence.hookName === ha.subject.symbol),
    );

    // Get side effects for this component
    const componentSideEffects = sideEffectObservations.filter(
      se => se.file === componentFile && se.evidence.containingFunction === componentName,
    );

    const ctx: ComponentContext = {
      name: componentName,
      file: componentFile,
      line: componentLine,
      hasProps: propFields.length > 0,
      propCount: propFields.length,
      callbackPropCount: propFields.filter(p => p.evidence.isCallback).length,
      hookAssessments: [...componentHookAssessments],
      hookObservations: [...componentHookObs],
      sideEffects: [...componentSideEffects],
    };

    const containerSignals = extractContainerSignals(ctx, config);
    const leafSignals = extractLeafSignals(ctx, containerSignals, config);

    // Try classification rules in priority order
    const result =
      classifyLayoutShell(ctx, config) ??
      classifyContainer(ctx, containerSignals) ??
      classifyDdauComponent(ctx, leafSignals) ??
      classifyLeafViolation(ctx, leafSignals) ??
      classifyAmbiguous(ctx, containerSignals, leafSignals);

    // Add boundary confidence indicators
    const rationale = [...result.rationale];
    if (result.kind === 'AMBIGUOUS') {
      const signalCount = countContainerSignals(containerSignals);
      rationale.push(`[near-boundary] ${signalCount} container signal(s), classification uncertain`);
    }

    // Flag components with exactly 1 violation-level hook as near-boundary
    const violationHooks = ctx.hookAssessments.filter(
      ha =>
        (ha.kind === 'LIKELY_SERVICE_HOOK' || ha.kind === 'LIKELY_CONTEXT_HOOK') &&
        (ha.confidence === 'high' || ha.confidence === 'medium'),
    );
    if (violationHooks.length === 1 && result.kind !== 'CONTAINER' && result.kind !== 'LAYOUT_SHELL') {
      rationale.push(`[near-boundary] exactly 1 violation-level hook: ${violationHooks[0].subject.symbol}`);
    }

    assessments.push({
      kind: result.kind,
      subject: {
        file: componentFile,
        line: componentLine,
        symbol: componentName,
      },
      confidence: result.confidence,
      rationale,
      basedOn: buildBasedOn(componentObs, componentHookAssessments),
      isCandidate: result.isCandidate,
      requiresManualReview: result.requiresManualReview,
    });
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<OwnershipAssessment>, targetPath: string): string {
  const lines: string[] = [];
  lines.push(`Ownership Assessments: ${targetPath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No components found.');
    return lines.join('\n');
  }

  // Header
  lines.push(' File:Line         | Component            | Assessment      | Confidence | Signals');
  lines.push('-------------------+----------------------+-----------------+------------+---------------------------');

  for (const a of result.assessments) {
    const fileLine = `${path.basename(a.subject.file)}:${a.subject.line ?? '?'}`.padEnd(17);
    const component = (a.subject.symbol ?? 'unknown').slice(0, 20).padEnd(20);
    const assessment = a.kind.padEnd(15);
    const confidence = a.confidence.padEnd(10);
    const signals = a.rationale.join(', ').slice(0, 40);
    lines.push(` ${fileLine} | ${component} | ${assessment} | ${confidence} | ${signals}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Directory analysis (with caching)
// ---------------------------------------------------------------------------

/**
 * Analyze all files in a directory and collect ownership assessments.
 * This is the cached unit of work for directory-level analysis.
 */
function analyzeDirectory(filePaths: string[], pretty: boolean): AssessmentResult<OwnershipAssessment> {
  const allHookObservations: HookObservation[] = [];
  const allComponentObservations: ComponentObservation[] = [];
  const allHookAssessments: HookAssessment[] = [];

  for (const filePath of filePaths) {
    try {
      const inventory = analyzeReactFile(filePath);

      // Collect observations
      allHookObservations.push(...inventory.hookObservations);
      allComponentObservations.push(...inventory.componentObservations);

      // Get hook assessments
      if (inventory.hookObservations.length > 0) {
        const hookResult = interpretHooks(inventory.hookObservations, astConfig);
        allHookAssessments.push(...hookResult.assessments);
      }
    } catch (e) {
      if (!pretty) {
        console.error(`Warning: could not analyze ${filePath}: ${String(e)}`);
      }
    }
  }

  // Run ownership interpretation
  const inputs: OwnershipInputs = {
    hookAssessments: allHookAssessments,
    componentObservations: allComponentObservations,
    hookObservations: allHookObservations,
  };

  return interpretOwnership(inputs, astConfig);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);
  const noCache = hasNoCacheFlag(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-ownership.ts <file|dir> [--pretty] [--no-cache]\n' +
        '\n' +
        'Classify component ownership (DDAU/container/leaf).\n' +
        '\n' +
        'Assessment kinds:\n' +
        '  CONTAINER       - Owns data orchestration (service hooks, router, etc.)\n' +
        '  DDAU_COMPONENT  - Pure data-down-actions-up (all data via props)\n' +
        '  LAYOUT_SHELL    - Layout wrapper (documented exception)\n' +
        '  LEAF_VIOLATION  - Calls hooks it should not (service/context in leaf)\n' +
        '  AMBIGUOUS       - Mixed signals, needs manual review\n' +
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
    const absolute = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      isDirectory = true;
      dirPath = absolute;
      const files = getFilesInDirectory(absolute);
      filePaths.push(...files);
    } else {
      filePaths.push(absolute);
    }
  }

  if (filePaths.length === 0) {
    fatal('No .tsx files found.');
  }

  // Use directory-level caching if analyzing a directory
  let result: AssessmentResult<OwnershipAssessment>;

  if (isDirectory && filePaths.length > 1) {
    result = cachedDirectory(
      'interpret-ownership',
      dirPath,
      filePaths,
      () => analyzeDirectory(filePaths, args.pretty),
      { noCache },
    );
  } else {
    // Single file - no directory caching benefit
    result = analyzeDirectory(filePaths, args.pretty);
  }

  if (args.pretty) {
    const relativePaths = filePaths.map(f => path.relative(PROJECT_ROOT, f)).join(', ');
    const targetDisplay =
      filePaths.length > 3 ? `${path.dirname(path.relative(PROJECT_ROOT, filePaths[0]))}/` : relativePaths;
    process.stdout.write(formatPrettyOutput(result, targetDisplay) + '\n');
  } else {
    output(result, false);
  }

  // Output cache stats
  const stats = getCacheStats();
  process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-ownership.ts') || process.argv[1].endsWith('ast-interpret-ownership'));

if (isDirectRun) {
  main();
}
