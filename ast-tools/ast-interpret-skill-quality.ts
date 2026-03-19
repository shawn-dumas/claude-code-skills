/**
 * ast-interpret-skill-quality.ts
 *
 * Interpreter for skill analysis observations. Consumes observations from
 * ast-skill-analysis.ts and produces assessments: stale paths, broken
 * cross-refs, deprecated commands, and category-aware missing section checks.
 *
 * All thresholds and required-section definitions are sourced from
 * astConfig.skillQuality.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-interpret-skill-quality.ts <dir-or-file...> [--pretty]
 */

import path from 'path';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { resolveConfig } from './ast-config';
import { analyzeSkillFile, analyzeSkillDirectory } from './ast-skill-analysis';
import type {
  SkillAnalysisObservation,
  SkillAnalysisResult,
  SkillQualityAssessment,
  SkillQualityAssessmentKind,
  SkillQualityReport,
  ObservationRef,
} from './types';
import fs from 'fs';
import fg from 'fast-glob';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRef(obs: SkillAnalysisObservation): ObservationRef {
  return { kind: obs.kind, file: obs.file, line: obs.line };
}

function makeAssessment(
  kind: SkillQualityAssessmentKind,
  file: string,
  line: number | undefined,
  symbol: string | undefined,
  confidence: 'high' | 'medium' | 'low',
  rationale: string[],
  basedOn: readonly ObservationRef[],
  opts?: { isCandidate?: boolean; requiresManualReview?: boolean },
): SkillQualityAssessment {
  return {
    kind,
    subject: { file, line, symbol },
    confidence,
    rationale,
    basedOn,
    isCandidate: opts?.isCandidate ?? false,
    requiresManualReview: opts?.requiresManualReview ?? false,
  };
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

function classifyFilePaths(observations: readonly SkillAnalysisObservation[]): SkillQualityAssessment[] {
  const assessments: SkillQualityAssessment[] = [];
  const pathRefs = observations.filter(o => o.kind === 'SKILL_FILE_PATH_REF');

  for (const obs of pathRefs) {
    if (obs.evidence.exists === false) {
      assessments.push(
        makeAssessment(
          'STALE_FILE_PATH',
          obs.file,
          obs.line,
          obs.evidence.referencedPath,
          'high',
          [`Path \`${obs.evidence.referencedPath}\` does not exist on disk (context: ${obs.evidence.pathContext}).`],
          [toRef(obs)],
        ),
      );
    } else if (obs.evidence.exists === true) {
      assessments.push(
        makeAssessment(
          'PATH_VALID',
          obs.file,
          obs.line,
          obs.evidence.referencedPath,
          'high',
          [`Path \`${obs.evidence.referencedPath}\` verified on disk.`],
          [toRef(obs)],
        ),
      );
    }
  }

  return assessments;
}

function classifyCrossRefs(observations: readonly SkillAnalysisObservation[]): SkillQualityAssessment[] {
  const assessments: SkillQualityAssessment[] = [];
  const crossRefs = observations.filter(o => o.kind === 'SKILL_CROSS_REF');

  for (const obs of crossRefs) {
    if (obs.evidence.refExists === false) {
      assessments.push(
        makeAssessment(
          'BROKEN_CROSS_REF',
          obs.file,
          obs.line,
          obs.evidence.skillName,
          'high',
          [`Skill \`/${obs.evidence.skillName}\` does not exist in .claude/skills/.`],
          [toRef(obs)],
        ),
      );
    } else if (obs.evidence.refExists === true) {
      assessments.push(
        makeAssessment(
          'CROSS_REF_VALID',
          obs.file,
          obs.line,
          obs.evidence.skillName,
          'high',
          [`Skill \`/${obs.evidence.skillName}\` verified in .claude/skills/.`],
          [toRef(obs)],
        ),
      );
    }
  }

  return assessments;
}

function classifyDocRefs(observations: readonly SkillAnalysisObservation[]): SkillQualityAssessment[] {
  const assessments: SkillQualityAssessment[] = [];
  const docRefs = observations.filter(o => o.kind === 'SKILL_DOC_REF');

  for (const obs of docRefs) {
    if (obs.evidence.refExists === false) {
      assessments.push(
        makeAssessment(
          'BROKEN_DOC_REF',
          obs.file,
          obs.line,
          obs.evidence.referencedPath,
          'high',
          [`Doc \`${obs.evidence.referencedPath}\` does not exist.`],
          [toRef(obs)],
        ),
      );
    }
  }

  return assessments;
}

function classifyCommands(observations: readonly SkillAnalysisObservation[]): SkillQualityAssessment[] {
  const config = resolveConfig();
  const assessments: SkillQualityAssessment[] = [];
  const commands = observations.filter(o => o.kind === 'SKILL_COMMAND_REF');

  for (const obs of commands) {
    const content = obs.evidence.content ?? '';
    for (const dep of config.skillQuality.deprecatedCommandPatterns) {
      if (new RegExp(dep.pattern).test(content)) {
        assessments.push(
          makeAssessment(
            'STALE_COMMAND',
            obs.file,
            obs.line,
            content,
            'high',
            [`Deprecated command pattern. Use \`${dep.replacement}\` instead.`],
            [toRef(obs)],
          ),
        );
        break;
      }
    }
  }

  return assessments;
}

function classifySections(result: SkillAnalysisResult): SkillQualityAssessment[] {
  const config = resolveConfig();
  const assessments: SkillQualityAssessment[] = [];
  const required = config.skillQuality.requiredSections[result.category];

  // No requirements for 'other' category or categories without rules
  if (!required || required.length === 0) return assessments;

  const sections = result.observations.filter(o => o.kind === 'SKILL_SECTION');
  const sectionTexts = sections.map(s => (s.evidence.text ?? '').toLowerCase());

  const missing: string[] = [];
  const found: string[] = [];
  const basedOn: ObservationRef[] = [];

  for (const req of required) {
    const regex = new RegExp(req.pattern, 'i');
    const match = sectionTexts.some(t => regex.test(t));
    if (match) {
      found.push(req.label);
      // Find the matching section for basedOn
      const matchingObs = sections.find(s => regex.test((s.evidence.text ?? '').toLowerCase()));
      if (matchingObs) basedOn.push(toRef(matchingObs));
    } else {
      missing.push(req.label);
    }
  }

  if (missing.length === 0) {
    assessments.push(
      makeAssessment(
        'SECTION_COMPLETE',
        result.filePath,
        undefined,
        result.skillName,
        'high',
        [`All ${required.length} required sections for '${result.category}' category present: ${found.join(', ')}.`],
        basedOn,
      ),
    );
  } else {
    for (const label of missing) {
      assessments.push(
        makeAssessment(
          'MISSING_SECTION',
          result.filePath,
          undefined,
          label,
          'medium',
          [`Category '${result.category}' expects a '${label}' section but none was found.`],
          [],
          { requiresManualReview: true },
        ),
      );
    }
  }

  return assessments;
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

export function interpretSkillQuality(result: SkillAnalysisResult): SkillQualityReport {
  const assessments: SkillQualityAssessment[] = [
    ...classifyFilePaths(result.observations),
    ...classifyCrossRefs(result.observations),
    ...classifyDocRefs(result.observations),
    ...classifyCommands(result.observations),
    ...classifySections(result),
  ];

  const staleCount = assessments.filter(
    a =>
      a.kind === 'STALE_FILE_PATH' ||
      a.kind === 'STALE_COMMAND' ||
      a.kind === 'BROKEN_CROSS_REF' ||
      a.kind === 'BROKEN_DOC_REF',
  ).length;
  const missingCount = assessments.filter(a => a.kind === 'MISSING_SECTION').length;

  // Score: starts at 100, -5 per stale/broken finding, -3 per missing section
  const score = Math.max(0, 100 - staleCount * 5 - missingCount * 3);

  return {
    skillName: result.skillName,
    category: result.category,
    assessments,
    score,
    staleCount,
    missingCount,
  };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function prettyPrint(report: SkillQualityReport): string {
  const lines: string[] = [];
  lines.push(`Skill Quality: ${report.skillName} (${report.category})`);
  lines.push(`Score: ${report.score}/100  |  Stale: ${report.staleCount}  |  Missing sections: ${report.missingCount}`);
  lines.push('');

  const issues = report.assessments.filter(
    a =>
      a.kind === 'STALE_FILE_PATH' ||
      a.kind === 'STALE_COMMAND' ||
      a.kind === 'BROKEN_CROSS_REF' ||
      a.kind === 'BROKEN_DOC_REF' ||
      a.kind === 'MISSING_SECTION',
  );

  if (issues.length === 0) {
    lines.push('No issues found.');
    return lines.join('\n');
  }

  lines.push(' Line | Assessment         | Subject');
  lines.push('------+--------------------+----------------------------------------');

  for (const a of issues) {
    const line = a.subject.line ? String(a.subject.line).padStart(5) : '    -';
    const kind = a.kind.padEnd(18);
    const subject = (a.subject.symbol ?? '-').slice(0, 40);
    lines.push(`${line} | ${kind} | ${subject}`);
  }

  lines.push('');
  lines.push('Details:');
  for (const a of issues) {
    const symbol = a.subject.symbol ?? '-';
    lines.push(`  ${a.kind}: ${symbol}`);
    for (const r of a.rationale) {
      lines.push(`    ${r}`);
    }
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
      'Usage: npx tsx scripts/AST/ast-interpret-skill-quality.ts <dir-or-file...> [--pretty]\n\n' +
        'Interpret skill analysis observations and classify quality issues.\n\n' +
        'Assessment kinds:\n' +
        '  STALE_FILE_PATH     File path does not exist on disk\n' +
        '  STALE_COMMAND       Command uses deprecated pattern\n' +
        '  BROKEN_CROSS_REF    Skill cross-reference does not exist\n' +
        '  BROKEN_DOC_REF      Doc reference does not exist\n' +
        '  MISSING_SECTION     Category-required section not found\n' +
        '  SECTION_COMPLETE    All required sections present\n' +
        '  PATH_VALID          File path verified on disk\n' +
        '  CROSS_REF_VALID     Skill cross-ref verified\n\n' +
        'Options:\n' +
        '  --pretty   Human-readable table output\n' +
        '  --help     Show this help\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No directory or file path provided. Use --help for usage.');
  }

  const allResults: SkillAnalysisResult[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeSkillDirectory(absolute));
    } else {
      const skillsDir = path.dirname(path.dirname(absolute));
      const siblingSkills = fg.sync('*/SKILL.md', { cwd: skillsDir, absolute: true });
      const skillDirs = new Set(siblingSkills.map(f => path.basename(path.dirname(f))));
      allResults.push(analyzeSkillFile(absolute, skillDirs));
    }
  }

  const reports = allResults.map(r => interpretSkillQuality(r));

  if (args.pretty) {
    for (const report of reports) {
      process.stdout.write(prettyPrint(report) + '\n\n');
    }
  } else {
    const result = reports.length === 1 ? reports[0] : reports;
    output(result, false);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-skill-quality.ts') ||
    process.argv[1].endsWith('ast-interpret-skill-quality'));

if (isDirectRun) {
  main();
}
