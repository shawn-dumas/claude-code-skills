/**
 * Refactor intent observation tool.
 *
 * Reads HEAD (before) and dirty (after) versions of file(s), runs all
 * observation tools on both, and produces a paired signal inventory.
 * This tool does NOT classify signals -- it only collects and pairs them.
 * Classification is handled by a separate interpreter (Phase 7).
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { createVirtualProject, gitGetHeadContent } from './git-source';
import { runAllObservers } from './tool-registry';
import { astConfig } from './ast-config';
import type { AnyObservation, RefactorSignalPair } from './types';

// ---------------------------------------------------------------------------
// Similarity computation
// ---------------------------------------------------------------------------

/**
 * Compute Jaccard similarity between two sets of strings.
 * Returns 0 for empty sets, 1 for identical sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Calibrated: 2026-03-14
 * Tool: intent
 * Fixtures: 12 (7 synthetic, 2 git-history, 3 parity)
 * Accuracy: 100% (55/55 intent, 10/10 parity)
 * Bias: 0 FP, 0 FN for ACCIDENTALLY_DROPPED
 *
 * Algorithmic fixes applied:
 *   1. Context evidence de-duplication: parentFunction/containingFunction
 *      excluded from Jaccard (already scored by functionContextScore)
 *   2. Cross-file name matching: functionContextScore returns 0.7 when
 *      primary name matches but containing function differs
 *   3. Name-based greedy tie-breaking: sort prefers name-matched pairs
 *      within 0.05 similarity (prevents CC-based false matches)
 */

/**
 * Context fields already handled by functionContextScore.
 * Excluded from Jaccard evidence to prevent double-counting.
 */
const CONTEXT_EVIDENCE_FIELDS = new Set(['parentFunction', 'containingFunction']);

/**
 * Flatten evidence fields into a set of strings for comparison.
 * Each field is represented as "key=value". Context fields are excluded
 * because they are already scored by functionContextScore.
 */
function evidenceToStringSet(evidence: Record<string, unknown>): Set<string> {
  const entries = new Set<string>();
  for (const [key, value] of Object.entries(evidence)) {
    if (CONTEXT_EVIDENCE_FIELDS.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.add(`${key}=${String(item)}`);
      }
    } else if (typeof value === 'object') {
      entries.add(`${key}=${JSON.stringify(value)}`);
    } else {
      entries.add(`${key}=${JSON.stringify(value)}`);
    }
  }
  return entries;
}

/**
 * Extract the primary identifying name from an observation's evidence.
 * Returns the first non-empty value from kind-appropriate fields.
 */
function getPrimaryName(obs: AnyObservation): string | null {
  const evidence = obs.evidence as Record<string, unknown>;
  for (const field of ['hookName', 'functionName', 'name', 'exportName', 'propName', 'method', 'source', 'url']) {
    const val = evidence[field];
    if (typeof val === 'string' && val.length > 0) return val;
  }
  // For COMPONENT_DECLARATION, componentName is the primary identifier
  if (obs.kind === 'COMPONENT_DECLARATION') {
    const val = evidence.componentName;
    if (typeof val === 'string' && val.length > 0) return val;
  }
  return null;
}

/**
 * Compute function context similarity between two observations.
 * Checks parentFunction / containingFunction / componentName fields.
 *
 * Returns a partial score (0.7) when contexts differ but the primary
 * identifying name matches -- this handles cross-file refactoring
 * where hooks/functions move between files and their containing
 * function changes.
 */
function functionContextScore(before: AnyObservation, after: AnyObservation): number {
  const beforeEvidence = before.evidence as Record<string, unknown>;
  const afterEvidence = after.evidence as Record<string, unknown>;

  const beforeCtx =
    (beforeEvidence.parentFunction as string) ??
    (beforeEvidence.containingFunction as string) ??
    (beforeEvidence.componentName as string) ??
    '';
  const afterCtx =
    (afterEvidence.parentFunction as string) ??
    (afterEvidence.containingFunction as string) ??
    (afterEvidence.componentName as string) ??
    '';

  if (beforeCtx === '' && afterCtx === '') return 1;
  if (beforeCtx === afterCtx) return 1;

  // Cross-file move heuristic: if the primary name matches but the
  // containing function changed, this is likely a hook/function that
  // moved during a file-split refactor. Return partial credit.
  const beforeName = getPrimaryName(before);
  const afterName = getPrimaryName(after);
  if (beforeName !== null && beforeName === afterName) {
    return 0.7;
  }

  return 0;
}

/**
 * Compute position similarity based on relative line position.
 * Returns 1 for same line, decays toward 0 as lines diverge.
 */
function positionScore(before: AnyObservation, after: AnyObservation): number {
  const diff = Math.abs(before.line - after.line);
  // Exponential decay: same line = 1, 50 lines apart ~ 0.37, 200 lines ~ 0.02
  return Math.exp(-diff / 50);
}

// Matching weights from the prompt spec
const WEIGHT_FUNCTION_CONTEXT = 0.5;
const WEIGHT_EVIDENCE = 0.35;
const WEIGHT_POSITION = 0.15;

/**
 * Compute similarity between two observations.
 * Returns 0 if kinds do not match (hard gate).
 */
function computeSimilarity(before: AnyObservation, after: AnyObservation): number {
  // Kind match is a hard gate
  if (before.kind !== after.kind) return 0;

  const fcScore = functionContextScore(before, after);
  const evScore = jaccardSimilarity(
    evidenceToStringSet(before.evidence as Record<string, unknown>),
    evidenceToStringSet(after.evidence as Record<string, unknown>),
  );
  const posScore = positionScore(before, after);

  return WEIGHT_FUNCTION_CONTEXT * fcScore + WEIGHT_EVIDENCE * evScore + WEIGHT_POSITION * posScore;
}

// ---------------------------------------------------------------------------
// Observation collection
// ---------------------------------------------------------------------------

const { ignoredKinds } = astConfig.intentMatcher;

function filterIgnoredKinds(observations: AnyObservation[]): AnyObservation[] {
  return observations.filter(o => !ignoredKinds.has(o.kind));
}

/**
 * Collect observations from source content.
 *
 * Writes content to a temp file so that filePath-based tools in the registry
 * (complexity, react-inventory, jsx-analysis, type-safety, test-analysis,
 * data-layer, pw-test-parity, vitest-parity) read the correct content instead
 * of whatever is on disk at `filePath`. Without this, those tools produce
 * identical before/after observations when comparing HEAD vs. working tree,
 * rendering them useless for intent detection.
 *
 * SourceFile-based tools use the virtual SourceFile created from `content`.
 */
function collectObservations(content: string, filePath: string): AnyObservation[] {
  // Write content to a temp file so filePath-based tools read it
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-intent-'));
  const tmpFile = path.join(tmpDir, path.basename(filePath));
  fs.writeFileSync(tmpFile, content);

  try {
    const project = createVirtualProject();
    const ext = path.extname(filePath);
    const virtualPath = `/virtual/${path.basename(filePath)}${ext ? '' : '.tsx'}`;
    const sourceFile = project.createSourceFile(virtualPath, content, { overwrite: true });

    // Pass tmpFile as filePath so filePath-based tools read from the temp
    // copy (correct content) instead of the real disk path (may differ).
    const raw = runAllObservers(sourceFile, tmpFile);

    // Normalize paths: map both virtual and temp paths back to the real
    // filePath, then scope to only observations from the target file.
    const normalized = raw.map(obs => {
      if (obs.file.startsWith('/virtual/') || obs.file === tmpFile || obs.file.includes(tmpDir)) {
        return { ...obs, file: filePath };
      }
      return obs;
    });

    const scoped = normalized.filter(obs => obs.file === filePath);
    return filterIgnoredKinds(scoped);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Warning: observation collection failed for ${filePath}: ${message}\n`);
    return [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Get the git-relative path for a file path.
 * Strips the PROJECT_ROOT prefix.
 */
function toRelativePath(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  return path.relative(PROJECT_ROOT, absolute);
}

/**
 * Compute file content hash via git hash-object.
 * Returns null if the command fails.
 */
function gitHashObject(content: string): string | null {
  try {
    return execFileSync('git', ['hash-object', '--stdin'], {
      input: content,
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    }).trim();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Signal matching
// ---------------------------------------------------------------------------

/**
 * Greedy best-first matching between before and after observations.
 * File-agnostic -- operates on flat lists.
 */
export function matchSignals(
  beforeObs: AnyObservation[],
  afterObs: AnyObservation[],
  matchMinimum: number,
): {
  matched: { before: AnyObservation; after: AnyObservation; similarity: number }[];
  unmatched: AnyObservation[];
  novel: AnyObservation[];
} {
  // Build all candidate pairs with their similarity scores
  const candidates: {
    beforeIdx: number;
    afterIdx: number;
    similarity: number;
  }[] = [];

  for (let bi = 0; bi < beforeObs.length; bi++) {
    for (let ai = 0; ai < afterObs.length; ai++) {
      const sim = computeSimilarity(beforeObs[bi], afterObs[ai]);
      if (sim >= matchMinimum) {
        candidates.push({ beforeIdx: bi, afterIdx: ai, similarity: sim });
      }
    }
  }

  // Sort descending by similarity, with name-match tie-breaking.
  // When two candidates have similar scores, prefer the one where
  // the primary identifying name matches (prevents greedy matching
  // from pairing functions with similar metrics but different names).
  candidates.sort((a, b) => {
    const simDiff = b.similarity - a.similarity;
    if (Math.abs(simDiff) > 0.05) return simDiff;

    // Tie-break: prefer name matches
    const aBeforeName = getPrimaryName(beforeObs[a.beforeIdx]);
    const aAfterName = getPrimaryName(afterObs[a.afterIdx]);
    const bBeforeName = getPrimaryName(beforeObs[b.beforeIdx]);
    const bAfterName = getPrimaryName(afterObs[b.afterIdx]);
    const aNameMatch = aBeforeName !== null && aBeforeName === aAfterName ? 1 : 0;
    const bNameMatch = bBeforeName !== null && bBeforeName === bAfterName ? 1 : 0;

    if (bNameMatch !== aNameMatch) return bNameMatch - aNameMatch;
    return simDiff;
  });

  const usedBefore = new Set<number>();
  const usedAfter = new Set<number>();
  const matched: { before: AnyObservation; after: AnyObservation; similarity: number }[] = [];

  for (const candidate of candidates) {
    if (usedBefore.has(candidate.beforeIdx) || usedAfter.has(candidate.afterIdx)) continue;
    usedBefore.add(candidate.beforeIdx);
    usedAfter.add(candidate.afterIdx);
    matched.push({
      before: beforeObs[candidate.beforeIdx],
      after: afterObs[candidate.afterIdx],
      similarity: candidate.similarity,
    });
  }

  const unmatched = beforeObs.filter((_, i) => !usedBefore.has(i));
  const novel = afterObs.filter((_, i) => !usedAfter.has(i));

  return { matched, unmatched, novel };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze refactor intent by comparing observations from before and after
 * file versions.
 *
 * @param beforeFiles - Array of file paths. For each, the HEAD version is
 *   read via git show. If no HEAD version exists, the file is treated as new.
 * @param afterFiles - Array of file paths. For each, the current filesystem
 *   version is read. If the file does not exist, it is treated as deleted.
 */
export function analyzeRefactorIntent(beforeFiles: string[], afterFiles: string[]): RefactorSignalPair {
  const allBeforeObs: AnyObservation[] = [];
  const allAfterObs: AnyObservation[] = [];
  const beforeFilePaths: string[] = [];
  const afterFilePaths: string[] = [];

  // Collect observations from before (HEAD) versions
  for (const filePath of beforeFiles) {
    const relativePath = toRelativePath(filePath);
    const headContent = gitGetHeadContent(relativePath);

    if (headContent === null) {
      // New file -- no HEAD version, skip before observations
      continue;
    }

    beforeFilePaths.push(relativePath);

    // Check if file is unchanged (same content in HEAD and on disk)
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
    if (fs.existsSync(absolute)) {
      const diskContent = fs.readFileSync(absolute, 'utf-8');
      const headHash = gitHashObject(headContent);
      const diskHash = gitHashObject(diskContent);
      if (headHash !== null && diskHash !== null && headHash === diskHash) {
        // Unchanged file -- skip observation collection
        continue;
      }
    }

    try {
      const observations = collectObservations(headContent, relativePath);
      allBeforeObs.push(...observations);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: failed to collect HEAD observations for ${relativePath}: ${msg}\n`);
    }
  }

  // Collect observations from after (filesystem) versions
  for (const filePath of afterFiles) {
    const relativePath = toRelativePath(filePath);
    const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);

    if (!fs.existsSync(absolute)) {
      // Deleted file -- no after observations
      continue;
    }

    afterFilePaths.push(relativePath);

    let content: string;
    try {
      content = fs.readFileSync(absolute, 'utf-8');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: failed to read ${relativePath}: ${msg}\n`);
      continue;
    }

    // Skip binary/non-parseable files
    if (content.includes('\0')) {
      process.stderr.write(`Warning: skipping binary file ${relativePath}\n`);
      continue;
    }

    // Check if file is unchanged -- already handled above for before,
    // but for after-only files (no before counterpart), still collect
    const headContent = gitGetHeadContent(relativePath);
    if (headContent !== null) {
      const headHash = gitHashObject(headContent);
      const diskHash = gitHashObject(content);
      if (headHash !== null && diskHash !== null && headHash === diskHash) {
        continue;
      }
    }

    try {
      const observations = collectObservations(content, relativePath);
      allAfterObs.push(...observations);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Warning: failed to collect observations for ${relativePath}: ${msg}\n`);
    }
  }

  // Match signals using the fail threshold as the minimum match score
  const matchMinimum = astConfig.intentMatcher.thresholds.fail;
  const { matched, unmatched, novel } = matchSignals(allBeforeObs, allAfterObs, matchMinimum);

  return {
    before: { files: beforeFilePaths, observations: allBeforeObs },
    after: { files: afterFilePaths, observations: allAfterObs },
    unmatched,
    novel,
    matched,
  };
}

// ---------------------------------------------------------------------------
// Pretty print
// ---------------------------------------------------------------------------

function formatObservation(obs: AnyObservation): string {
  const evidence = obs.evidence as Record<string, unknown>;
  const contextKey = (evidence.parentFunction ?? evidence.containingFunction ?? evidence.componentName ?? '') as string;
  const context = contextKey ? ` in ${contextKey}` : '';

  // Include key identifying evidence fields for readability
  const identifiers: string[] = [];
  for (const key of ['hookName', 'propName', 'name', 'method', 'target', 'flagName'] as const) {
    const val = evidence[key];
    if (typeof val === 'string' && val.length > 0) {
      identifiers.push(`${key}=${val}`);
    }
  }
  const detail = identifiers.length > 0 ? ` (${identifiers.join(', ')})` : '';

  return `${obs.kind} at ${obs.file}:${obs.line}${context}${detail}`;
}

export function prettyPrint(result: RefactorSignalPair): string {
  const lines: string[] = [];

  lines.push('=== REFACTOR INTENT OBSERVATION ===');
  lines.push('');
  lines.push(`Before: ${result.before.files.length} file(s), ${result.before.observations.length} observation(s)`);
  lines.push(`After:  ${result.after.files.length} file(s), ${result.after.observations.length} observation(s)`);
  lines.push('');

  // Matched
  lines.push(`MATCHED (${result.matched.length}):`);
  if (result.matched.length === 0) {
    lines.push('  (none)');
  } else {
    for (const m of result.matched) {
      lines.push(`  [${(m.similarity * 100).toFixed(0)}%] ${formatObservation(m.before)}`);
      lines.push(`    -> ${formatObservation(m.after)}`);
    }
  }
  lines.push('');

  // Unmatched (before signals with no after match)
  lines.push(`UNMATCHED (${result.unmatched.length}):`);
  if (result.unmatched.length === 0) {
    lines.push('  (none)');
  } else {
    for (const u of result.unmatched) {
      lines.push(`  ${formatObservation(u)}`);
    }
  }
  lines.push('');

  // Novel (after signals with no before match)
  lines.push(`NOVEL (${result.novel.length}):`);
  if (result.novel.length === 0) {
    lines.push('  (none)');
  } else {
    for (const n of result.novel) {
      lines.push(`  ${formatObservation(n)}`);
    }
  }
  lines.push('');
  lines.push('=== END ===');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parse --before / --after file lists from argv.
 * Each keyword consumes non-flag args until the next --keyword or end.
 * Also supports legacy `<before...> -- <after...>` separator format.
 */
export function parseBeforeAfter(argv: string[]): { beforePaths: string[]; afterPaths: string[] } {
  const rawArgs = argv.slice(2);
  const hasBeforeFlag = rawArgs.includes('--before');
  const hasAfterFlag = rawArgs.includes('--after');

  if (hasBeforeFlag || hasAfterFlag) {
    const beforePaths: string[] = [];
    const afterPaths: string[] = [];
    let current: string[] | null = null;

    for (const arg of rawArgs) {
      if (arg === '--before') {
        current = beforePaths;
      } else if (arg === '--after') {
        current = afterPaths;
      } else if (arg.startsWith('--')) {
        current = null;
      } else if (current !== null) {
        current.push(arg);
      }
    }

    return { beforePaths, afterPaths };
  }

  // Legacy: <before...> -- <after...>
  const cleaned = rawArgs.filter(a => a !== '--pretty' && a !== '--help');
  const separatorIdx = cleaned.indexOf('--');

  if (separatorIdx === -1) {
    return { beforePaths: cleaned, afterPaths: cleaned };
  }

  return {
    beforePaths: cleaned.slice(0, separatorIdx),
    afterPaths: cleaned.slice(separatorIdx + 1),
  };
}

export function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-refactor-intent.ts \\\n' +
        '  --before <before-files...> --after <after-files...> [--pretty]\n' +
        '\n' +
        'Compare observations between HEAD and filesystem versions of files.\n' +
        '\n' +
        '  --before    Files to analyze from HEAD (before refactor)\n' +
        '  --after     Files to analyze from disk (after refactor)\n' +
        '  --pretty    Human-readable output instead of JSON\n' +
        '  --help      Show this help message\n' +
        '\n' +
        'Legacy: <before-files...> -- <after-files...> [--pretty]\n',
    );
    process.exit(0);
  }

  const { beforePaths, afterPaths } = parseBeforeAfter(process.argv);

  if (beforePaths.length === 0 && afterPaths.length === 0) {
    fatal('No file paths provided. Use --help for usage.');
  }

  const result = analyzeRefactorIntent(beforePaths, afterPaths);

  if (args.pretty) {
    process.stdout.write(prettyPrint(result) + '\n');
  } else {
    output(result, false);
  }
}

/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-refactor-intent.ts') || process.argv[1].endsWith('ast-refactor-intent'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
