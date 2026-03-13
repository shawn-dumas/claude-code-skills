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
 * Check if a setter name mirrors a prop name.
 * E.g., dep 'userId' with setter 'setUser' or 'setUserId' is a mirror.
 */
function setterMirrorsProp(setterName: string, propName: string): boolean {
  // setX mirrors X
  if (setterName.toLowerCase() === `set${propName.toLowerCase()}`) {
    return true;
  }
  // setXyz mirrors xyz or Xyz
  const withoutSet = setterName.replace(/^set/, '');
  if (withoutSet.toLowerCase() === propName.toLowerCase()) {
    return true;
  }
  // setUser mirrors userId (prop is longer)
  if (propName.toLowerCase().startsWith(withoutSet.toLowerCase())) {
    return true;
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
  if (group.hasDomApi || group.hasRefTouch) {
    // DOM effects are legitimate if no state setter abuse
    const rationale: string[] = [];
    const basedOnKinds: string[] = [];

    if (group.hasDomApi) {
      rationale.push('contains DOM API access');
      basedOnKinds.push('EFFECT_DOM_API');
    }
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
    // Try classification rules in priority order
    const result =
      classifyDerivedState(group) ??
      classifyEventHandlerDisguised(group) ??
      classifyTimerRace(group) ??
      classifyDomEffect(group) ??
      classifyExternalSubscription(group) ??
      classifyNecessary(group);

    assessments.push({
      kind: result.kind,
      subject: {
        file,
        line: group.effectLine,
        symbol: group.parentFunction,
      },
      confidence: result.confidence,
      rationale: result.rationale,
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
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-effects.ts <file|dir> [--pretty]\n' +
        '\n' +
        'Interpret useEffect observations and classify them.\n' +
        '\n' +
        '  <file|dir>  A .tsx/.ts file or directory to analyze\n' +
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
    const fs = require('fs');
    const absolute = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
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

  // Analyze all files and collect assessments
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
      if (!args.pretty) {
        console.error(`Warning: could not analyze ${filePath}: ${e}`);
      }
    }
  }

  const finalResult: AssessmentResult<EffectAssessment> = { assessments: allAssessments };

  if (args.pretty) {
    const relativePaths = filePaths.map(f => path.relative(PROJECT_ROOT, f)).join(', ');
    process.stdout.write(formatPrettyOutput(finalResult, relativePaths) + '\n');
  } else {
    output(finalResult, false);
  }
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-effects.ts') || process.argv[1].endsWith('ast-interpret-effects'));

if (isDirectRun) {
  main();
}
