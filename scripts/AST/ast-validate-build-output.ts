import path from 'path';
import fs from 'fs';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { analyzeTestFile } from './ast-test-analysis';
import { interpretTestQuality } from './ast-interpret-test-quality';
import type { TestQualityAssessment, TestQualityAssessmentKind } from './types';

export interface ValidationGate {
  readonly name: string;
  readonly passed: boolean;
  readonly offenders: readonly {
    readonly kind: TestQualityAssessmentKind;
    readonly line?: number;
    readonly rationale: readonly string[];
  }[];
}

export interface ValidationReport {
  readonly file: string;
  readonly passed: boolean;
  readonly gates: readonly ValidationGate[];
  readonly assessmentCount: number;
}

const GATE_CONFIG: readonly { readonly name: string; readonly failingKinds: readonly TestQualityAssessmentKind[] }[] = [
  { name: 'no-internal-mocking', failingKinds: ['MOCK_INTERNAL_VIOLATION'] },
  { name: 'type-safe-data-sourcing', failingKinds: ['DATA_SOURCING_VIOLATION'] },
  { name: 'cleanup-complete', failingKinds: ['CLEANUP_INCOMPLETE'] },
  { name: 'not-orphaned', failingKinds: ['ORPHANED_TEST'] },
];

function buildGates(assessments: readonly TestQualityAssessment[]): ValidationGate[] {
  const gates: ValidationGate[] = GATE_CONFIG.map(({ name, failingKinds }) => {
    const offenders = assessments
      .filter(a => failingKinds.includes(a.kind))
      .map(a => ({ kind: a.kind, line: a.subject.line, rationale: a.rationale }));
    return { name, passed: offenders.length === 0, offenders };
  });

  const userVisibleCount = assessments.filter(a => a.kind === 'ASSERTION_USER_VISIBLE').length;
  gates.push({
    name: 'user-visible-assertions-present',
    passed: userVisibleCount > 0,
    offenders:
      userVisibleCount === 0
        ? [{ kind: 'ASSERTION_USER_VISIBLE', rationale: ['spec emits zero user-visible assertions'] }]
        : [],
  });

  return gates;
}

export function validateBuildOutput(filePath: string): ValidationReport {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Path does not exist: ${filePath}`);
  }

  const analysis = analyzeTestFile(absolute);
  const { assessments } = interpretTestQuality(analysis.observations);

  const gates = buildGates(assessments);
  const passed = gates.every(g => g.passed);

  return {
    file: path.relative(PROJECT_ROOT, absolute),
    passed,
    gates,
    assessmentCount: assessments.length,
  };
}

export function main(): void {
  const args = parseArgs(process.argv);
  if (args.help || args.paths.length === 0) {
    process.stdout.write(
      'Usage: ast-validate-build-output <path> [--pretty]\n' +
        '\n' +
        'Validates a generated test file against contract-first testing\n' +
        'gates: no internal mocking, type-safe data sourcing, cleanup\n' +
        'present, subject file exists, and at least one user-visible\n' +
        'assertion. Consumed by build-react-test Step 7 (Verify).\n' +
        '\n' +
        'Exits non-zero if any gate fails.\n',
    );
    process.exit(args.help ? 0 : 1);
  }

  const reports: ValidationReport[] = [];
  for (const p of args.paths) {
    try {
      reports.push(validateBuildOutput(p));
    } catch (err) {
      fatal(`failed: ${p}: ${(err as Error).message}`);
    }
  }

  output({ reports }, args.pretty);

  if (reports.some(r => !r.passed)) {
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
