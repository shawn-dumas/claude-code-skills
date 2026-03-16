import path from 'path';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { analyzeReactFile } from './ast-react-inventory';
import type {
  EffectObservation,
  EffectAssessment,
  EffectAssessmentKind,
  ObservationRef,
  AssessmentResult,
} from './types';
import { cachedDirectory, hasNoCacheFlag, getCacheStats } from './ast-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupedObservations {
  effectLine: number;
  parentFunction: string;
  observations: EffectObservation[];
  hasCleanup: boolean;
  hasStateSetter: boolean;
  hasFetchCall: boolean;
  hasAsyncCall: boolean;
  hasTimerCall: boolean;
  hasDomApi: boolean;
  hasRefTouch: boolean;
  stateSetterNames: string[];
  depEntries: string[];
  propReads: string[];
  contextReads: string[];
}

// ---------------------------------------------------------------------------
// Observation grouping
// ---------------------------------------------------------------------------

/**
 * Group observations by effectLine so each useEffect is assessed once.
 */
function groupObservationsByEffect(observations: readonly EffectObservation[]): GroupedObservations[] {
  const byLine = new Map<number, EffectObservation[]>();

  for (const obs of observations) {
    const line = obs.evidence.effectLine;
    if (!byLine.has(line)) {
      byLine.set(line, []);
    }
    byLine.get(line)!.push(obs);
  }

  const groups: GroupedObservations[] = [];

  for (const [effectLine, obs] of byLine.entries()) {
    const locationObs = obs.find(o => o.kind === 'EFFECT_LOCATION');
    const parentFunction = locationObs?.evidence.parentFunction ?? 'unknown';

    groups.push({
      effectLine,
      parentFunction,
      observations: obs,
      hasCleanup: obs.some(o => o.kind === 'EFFECT_CLEANUP_PRESENT'),
      hasStateSetter: obs.some(o => o.kind === 'EFFECT_STATE_SETTER_CALL'),
      hasFetchCall: obs.some(o => o.kind === 'EFFECT_FETCH_CALL'),
      hasAsyncCall: obs.some(o => o.kind === 'EFFECT_ASYNC_CALL'),
      hasTimerCall: obs.some(o => o.kind === 'EFFECT_TIMER_CALL'),
      hasDomApi: obs.some(o => o.kind === 'EFFECT_DOM_API'),
      hasRefTouch: obs.some(o => o.kind === 'EFFECT_REF_TOUCH'),
      stateSetterNames: obs
        .filter(o => o.kind === 'EFFECT_STATE_SETTER_CALL')
        .map(o => o.evidence.identifier ?? '')
        .filter(Boolean),
      depEntries: obs
        .filter(o => o.kind === 'EFFECT_DEP_ENTRY')
        .map(o => o.evidence.identifier ?? '')
        .filter(Boolean),
      propReads: obs
        .filter(o => o.kind === 'EFFECT_PROP_READ')
        .map(o => o.evidence.identifier ?? '')
        .filter(Boolean),
      contextReads: obs
        .filter(o => o.kind === 'EFFECT_CONTEXT_READ')
        .map(o => o.evidence.identifier ?? '')
        .filter(Boolean),
    });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

/**
 * Build ObservationRef array from observations for basedOn field.
 */
function buildBasedOn(observations: EffectObservation[], filterKinds?: string[]): readonly ObservationRef[] {
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

/**
 * Common prefixes on prop names that wrap an underlying value name.
 * E.g., `initialRowSelection` wraps `RowSelection`, `defaultCount` wraps `Count`.
 */
const PROP_VALUE_PREFIXES = ['initial', 'default', 'prev', 'previous', 'old', 'cached'];

/**
 * Check if a setter name mirrors a prop name.
 * E.g., dep 'userId' with setter 'setUser' or 'setUserId' is a mirror.
 * Also handles prefix-in-prop: 'setRowSelection' mirrors 'initialRowSelection'
 * by stripping common prefixes (initial, default, prev) from the prop name.
 */
function setterMirrorsProp(setterName: string, propName: string): boolean {
  // setX mirrors X
  if (setterName.toLowerCase() === `set${propName.toLowerCase()}`) {
    return true;
  }
  // setXyz mirrors xyz or Xyz
  const withoutSet = setterName.replace(/^set/, '');
  const withoutSetLower = withoutSet.toLowerCase();
  if (withoutSetLower === propName.toLowerCase()) {
    return true;
  }
  // setUser mirrors userId (prop is longer, setter root is a prefix of prop)
  if (propName.toLowerCase().startsWith(withoutSetLower)) {
    return true;
  }
  // setRowSelection mirrors initialRowSelection (prop has a value prefix)
  // Strip common prefixes from the prop name and re-compare
  const propLower = propName.toLowerCase();
  for (const prefix of PROP_VALUE_PREFIXES) {
    if (propLower.startsWith(prefix)) {
      const stripped = propLower.slice(prefix.length);
      if (stripped === withoutSetLower) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if any setter mirrors any prop in deps.
 */
function hasSetterMirroringDep(
  stateSetterNames: string[],
  depEntries: string[],
  propReads: string[],
): { mirror: boolean; setterName?: string; propName?: string } {
  for (const setter of stateSetterNames) {
    for (const dep of depEntries) {
      // Dep must be a prop (in propReads)
      if (propReads.includes(dep) && setterMirrorsProp(setter, dep)) {
        return { mirror: true, setterName: setter, propName: dep };
      }
    }
  }
  return { mirror: false };
}

interface ClassificationResult {
  kind: EffectAssessmentKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string[];
  isCandidate: boolean;
  requiresManualReview: boolean;
  basedOnKinds: string[];
}

/**
 * Count how many classification rules would match a group.
 * Used to detect near-boundary cases where multiple classifications apply.
 */
function countMatchingClassifications(group: GroupedObservations): string[] {
  const matched: string[] = [];
  if (classifyDerivedState(group)) matched.push('DERIVED_STATE');
  if (classifyEventHandlerDisguised(group)) matched.push('EVENT_HANDLER_DISGUISED');
  if (classifyTimerRace(group)) matched.push('TIMER_RACE');
  if (classifyDomEffect(group)) matched.push('DOM_EFFECT');
  if (classifyLifecycleImperative(group)) matched.push('NECESSARY');
  if (classifyExternalSubscription(group)) matched.push('EXTERNAL_SUBSCRIPTION');
  return matched;
}

function classifyDerivedState(group: GroupedObservations): ClassificationResult | null {
  // DERIVED_STATE: setter + (fetch or async) = "fetches data and puts it in state"
  if (group.hasStateSetter && (group.hasFetchCall || group.hasAsyncCall)) {
    const rationale: string[] = [];
    const basedOnKinds: string[] = ['EFFECT_STATE_SETTER_CALL'];

    if (group.hasFetchCall) {
      rationale.push(`calls setState from fetch result`);
      basedOnKinds.push('EFFECT_FETCH_CALL');
    } else if (group.hasAsyncCall) {
      rationale.push(`calls setState from async operation`);
      basedOnKinds.push('EFFECT_ASYNC_CALL');
    }

    if (!group.hasCleanup) {
      rationale.push('no cleanup present');
    }

    return {
      kind: 'DERIVED_STATE',
      confidence: group.hasCleanup ? 'medium' : 'high',
      rationale,
      isCandidate: true,
      requiresManualReview: true,
      basedOnKinds,
    };
  }

  // DERIVED_STATE: setter + prop mirror
  if (group.hasStateSetter && group.propReads.length > 0) {
    const mirror = hasSetterMirroringDep(group.stateSetterNames, group.depEntries, group.propReads);
    if (mirror.mirror) {
      return {
        kind: 'DERIVED_STATE',
        confidence: 'medium',
        rationale: [`depends on prop \`${mirror.propName}\` and mirrors into local state via \`${mirror.setterName}\``],
        isCandidate: true,
        requiresManualReview: true,
        basedOnKinds: ['EFFECT_STATE_SETTER_CALL', 'EFFECT_PROP_READ', 'EFFECT_DEP_ENTRY'],
      };
    }
  }

  // DERIVED_STATE: setter mirrors a dep entry directly (dep may be a useMemo local,
  // not a prop). E.g., setRowSelection(initialRowSelection) where initialRowSelection
  // is derived from props via useMemo. Only fires when the prop-mirror check above
  // did not match (no prop reads or prop name mismatch).
  if (group.hasStateSetter && group.depEntries.length > 0 && !group.hasFetchCall && !group.hasAsyncCall) {
    for (const setter of group.stateSetterNames) {
      for (const dep of group.depEntries) {
        if (setterMirrorsProp(setter, dep)) {
          return {
            kind: 'DERIVED_STATE',
            confidence: 'low',
            rationale: [`mirrors dep \`${dep}\` into local state via \`${setter}\` -- likely derived state`],
            isCandidate: true,
            requiresManualReview: true,
            basedOnKinds: ['EFFECT_STATE_SETTER_CALL', 'EFFECT_DEP_ENTRY'],
          };
        }
      }
    }
  }

  // DERIVED_STATE: setter + context read
  if (group.hasStateSetter && group.contextReads.length > 0) {
    return {
      kind: 'DERIVED_STATE',
      confidence: 'low',
      rationale: [`derives state from context value \`${group.contextReads[0]}\``],
      isCandidate: true,
      requiresManualReview: true,
      basedOnKinds: ['EFFECT_STATE_SETTER_CALL', 'EFFECT_CONTEXT_READ'],
    };
  }

  return null;
}

function classifyEventHandlerDisguised(group: GroupedObservations): ClassificationResult | null {
  // EVENT_HANDLER_DISGUISED: setter + single callback-like dep
  // OR effect that just calls a callback with no cleanup
  if (group.depEntries.length === 1) {
    const dep = group.depEntries[0];
    // Check if dep looks like a callback (starts with 'on' and is in propReads)
    if (dep.startsWith('on') && dep.length > 2 && group.propReads.includes(dep)) {
      return {
        kind: 'EVENT_HANDLER_DISGUISED',
        confidence: 'medium',
        rationale: [`effect depends on callback prop \`${dep}\`, likely an event handler in disguise`],
        isCandidate: true,
        requiresManualReview: true,
        basedOnKinds: ['EFFECT_DEP_ENTRY', 'EFFECT_PROP_READ'],
      };
    }
  }

  // Effect calls a callback prop and has a state dep
  for (const propRead of group.propReads) {
    if (propRead.startsWith('on') && propRead.length > 2) {
      // Has callback prop read in effect body
      if (group.depEntries.some(d => !d.startsWith('on') && group.propReads.includes(d) === false)) {
        // Has non-callback dep (likely state)
        return {
          kind: 'EVENT_HANDLER_DISGUISED',
          confidence: 'medium',
          rationale: [
            `effect reads callback prop \`${propRead}\` triggered by state change, should be an event handler`,
          ],
          isCandidate: true,
          requiresManualReview: true,
          basedOnKinds: ['EFFECT_PROP_READ'],
        };
      }
    }
  }

  return null;
}

function classifyTimerRace(group: GroupedObservations): ClassificationResult | null {
  if (!group.hasTimerCall) return null;

  if (group.hasStateSetter) {
    if (group.hasCleanup) {
      return {
        kind: 'TIMER_RACE',
        confidence: 'medium',
        rationale: ['contains timer and setState, cleanup present -- managed but complex'],
        isCandidate: false,
        requiresManualReview: false,
        basedOnKinds: ['EFFECT_TIMER_CALL', 'EFFECT_STATE_SETTER_CALL', 'EFFECT_CLEANUP_PRESENT'],
      };
    } else {
      return {
        kind: 'TIMER_RACE',
        confidence: 'high',
        rationale: ['contains timer and setState, no cleanup -- likely race condition'],
        isCandidate: true,
        requiresManualReview: true,
        basedOnKinds: ['EFFECT_TIMER_CALL', 'EFFECT_STATE_SETTER_CALL'],
      };
    }
  }

  // Timer without state setter is just a timer effect
  return null;
}

function classifyDomEffect(group: GroupedObservations): ClassificationResult | null {
  // Strong DOM_EFFECT: explicit DOM API access (document.*, window.*)
  // Ref-only access is handled separately at lower priority by classifyRefOnlyDomEffect
  if (group.hasDomApi) {
    const rationale: string[] = ['contains DOM API access'];
    const basedOnKinds: string[] = ['EFFECT_DOM_API'];

    if (group.hasRefTouch) {
      rationale.push('contains ref.current access');
      basedOnKinds.push('EFFECT_REF_TOUCH');
    }
    if (group.hasCleanup) {
      rationale.push('has cleanup function');
      basedOnKinds.push('EFFECT_CLEANUP_PRESENT');
    }

    return {
      kind: 'DOM_EFFECT',
      confidence: 'high',
      rationale,
      isCandidate: false,
      requiresManualReview: false,
      basedOnKinds,
    };
  }

  return null;
}

// NOTE: ref-only DOM_EFFECT (classifyRefOnlyDomEffect) was removed during
// calibration 2026-03-16. Ref.current access without explicit DOM API calls
// (window.*, document.*) is too ambiguous -- many refs store non-DOM values
// (dedup guards, previous-value tracking, change detection). Without
// distinguishing DOM property access (ref.current.scrollTop, ref.current.style)
// from value storage (ref.current = "some string"), ref-only access falls
// through to NECESSARY. This causes one known false negative on synth-effects-04
// line 11 (containerRef.current.scrollTop classified as NECESSARY instead of
// DOM_EFFECT). Fix path: enhance the observation layer to emit EFFECT_DOM_API
// for ref.current.{domProperty} patterns.

/**
 * Lifecycle imperative: effect calls a callback prop (often a setter from parent
 * context) in the body and clears it in cleanup. This is a mount/update push
 * pattern, not an external subscription.
 *
 * Pattern: cleanup + no local state setter + reads a prop that looks like a
 * setter (starts with "set") or is a callback prop.
 */
function classifyLifecycleImperative(group: GroupedObservations): ClassificationResult | null {
  if (!group.hasCleanup || group.hasStateSetter) return null;

  // Check if any prop read looks like a setter call (e.g., setHeaderMetricsProps)
  const setterPropReads = group.propReads.filter(p => /^set[A-Z]/.test(p));
  if (setterPropReads.length > 0) {
    return {
      kind: 'NECESSARY',
      confidence: 'medium',
      rationale: [
        `calls prop setter \`${setterPropReads[0]}\` with cleanup -- lifecycle imperative (mount/unmount push)`,
      ],
      isCandidate: false,
      requiresManualReview: false,
      basedOnKinds: ['EFFECT_CLEANUP_PRESENT', 'EFFECT_PROP_READ'],
    };
  }

  return null;
}

function classifyExternalSubscription(group: GroupedObservations): ClassificationResult | null {
  // External subscription: has cleanup, no suspicious state setter patterns
  if (group.hasCleanup && !group.hasStateSetter) {
    return {
      kind: 'EXTERNAL_SUBSCRIPTION',
      confidence: 'medium',
      rationale: ['effect with cleanup and no state manipulation -- likely external subscription'],
      isCandidate: false,
      requiresManualReview: false,
      basedOnKinds: ['EFFECT_CLEANUP_PRESENT'],
    };
  }

  return null;
}

function classifyNecessary(group: GroupedObservations): ClassificationResult {
  const rationale: string[] = [];

  if (group.observations.length === 1 && group.observations[0].kind === 'EFFECT_LOCATION') {
    rationale.push('empty effect body');
  } else if (group.hasCleanup && group.depEntries.length === 0) {
    rationale.push('cleanup-only effect with empty deps');
  } else {
    rationale.push('no suspicious patterns detected');
  }

  return {
    kind: 'NECESSARY',
    confidence: 'low',
    rationale,
    isCandidate: false,
    requiresManualReview: false,
    basedOnKinds: ['EFFECT_LOCATION'],
  };
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret effect observations and produce assessments.
 *
 * @param observations - Effect observations from ast-react-inventory
 * @param _componentProps - Optional list of component prop names (for future use)
 * @returns Assessment results
 */
export function interpretEffects(
  observations: readonly EffectObservation[],
  _componentProps?: string[],
): AssessmentResult<EffectAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const groups = groupObservationsByEffect(observations);
  const assessments: EffectAssessment[] = [];
  const file = observations[0].file;

  for (const group of groups) {
    // Try classification rules in priority order.
    // Note: classifyDomEffect only fires for explicit DOM API access (window/document).
    // Ref-only access (classifyRefOnlyDomEffect) is checked after EXTERNAL_SUBSCRIPTION
    // because many refs store non-DOM values (dedup guards, previous values).
    // classifyLifecycleImperative detects callback-prop-with-cleanup patterns
    // before they fall into EXTERNAL_SUBSCRIPTION.
    const result =
      classifyDerivedState(group) ??
      classifyEventHandlerDisguised(group) ??
      classifyTimerRace(group) ??
      classifyDomEffect(group) ??
      classifyLifecycleImperative(group) ??
      classifyExternalSubscription(group) ??
      classifyNecessary(group);

    // Detect near-boundary cases where multiple classifications match
    const matchingKinds = countMatchingClassifications(group);
    const rationale = [...result.rationale];
    if (matchingKinds.length > 1) {
      rationale.push(`[near-boundary] ${matchingKinds.length} patterns matched: ${matchingKinds.join(', ')}`);
    }

    assessments.push({
      kind: result.kind,
      subject: {
        file,
        line: group.effectLine,
        symbol: group.parentFunction,
      },
      confidence: result.confidence,
      rationale,
      basedOn: buildBasedOn(group.observations, result.basedOnKinds),
      isCandidate: result.isCandidate,
      requiresManualReview: result.requiresManualReview,
    });
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<EffectAssessment>, filePath: string): string {
  const lines: string[] = [];
  lines.push(`Effect Assessments: ${filePath}`);
  lines.push('');

  if (result.assessments.length === 0) {
    lines.push('No effects found.');
    return lines.join('\n');
  }

  // Header
  lines.push(' Line | Assessment              | Confidence | Candidate | Rationale');
  lines.push('------+-------------------------+------------+-----------+----------------------------------');

  for (const a of result.assessments) {
    const line = String(a.subject.line ?? '?').padStart(5);
    const assessment = a.kind.padEnd(23);
    const confidence = a.confidence.padEnd(10);
    const candidate = a.isCandidate ? 'yes' : 'no ';
    const rationale = a.rationale.join('; ').slice(0, 50);
    lines.push(`${line} | ${assessment} | ${confidence} | ${candidate}       | ${rationale}`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Directory analysis (with caching)
// ---------------------------------------------------------------------------

/**
 * Analyze all files in a directory and collect effect assessments.
 * This is the cached unit of work for directory-level analysis.
 */
function analyzeDirectory(filePaths: string[], pretty: boolean): AssessmentResult<EffectAssessment> {
  const allAssessments: EffectAssessment[] = [];

  for (const filePath of filePaths) {
    try {
      const inventory = analyzeReactFile(filePath);
      for (const comp of inventory.components) {
        if (comp.effectObservations.length > 0) {
          const result = interpretEffects(comp.effectObservations);
          allAssessments.push(...result.assessments);
        }
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
      'Usage: npx tsx scripts/AST/ast-interpret-effects.ts <file|dir> [--pretty] [--no-cache]\n' +
        '\n' +
        'Interpret useEffect observations and classify them.\n' +
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
  let finalResult: AssessmentResult<EffectAssessment>;

  if (isDirectory && filePaths.length > 1) {
    finalResult = cachedDirectory(
      'interpret-effects',
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
  (process.argv[1].endsWith('ast-interpret-effects.ts') || process.argv[1].endsWith('ast-interpret-effects'));

if (isDirectRun) {
  main();
}
