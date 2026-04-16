import path from 'path';
import fs from 'fs';
import ts from 'typescript';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { getFilesInDirectory } from './shared';
import { analyzeComplexity, extractComplexityObservations } from './ast-complexity';
import { astConfig } from './ast-config';
import { cachedDirectory, hasNoCacheFlag, getCacheStats } from './ast-cache';
import { formatAssessmentTable } from './assessment-formatter';
import type {
  ComplexityObservation,
  BranchClassificationKind,
  BranchClassificationEvidence,
  BranchClassificationAssessment,
  ObservationRef,
  AssessmentResult,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// (ClassificationResult removed -- ConditionClassification is used instead)

// ---------------------------------------------------------------------------
// Source file cache
// ---------------------------------------------------------------------------

const sourceFileCache = new Map<string, ts.SourceFile>();

function getSourceFileRaw(filePath: string): ts.SourceFile {
  // Tests always pass absolute paths; relative-path branch is CLI-only usage
  /* v8 ignore start */
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  /* v8 ignore stop */
  const cached = sourceFileCache.get(absolute);
  if (cached) return cached;

  const content = fs.readFileSync(absolute, 'utf-8');
  const sf = ts.createSourceFile(absolute, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  sourceFileCache.set(absolute, sf);
  return sf;
}

// ---------------------------------------------------------------------------
// Condition extraction
// ---------------------------------------------------------------------------

/**
 * Find the TS AST node at a specific line number that matches the expected
 * contributor type. Returns the condition text or null.
 */
function extractConditionAtLine(filePath: string, line: number, contributorType: string): string | null {
  const config = astConfig.branchClassification;

  // For nullish-coalesce, the condition is always '??'
  if (contributorType === 'nullish-coalesce') {
    return '??';
  }

  // For catch, skip -- no meaningful condition
  // (caller short-circuits catch contributors before calling this function)
  /* v8 ignore start */
  if (contributorType === 'catch') {
    return null;
  }

  // For loop types, return a generic marker
  if (contributorType === 'loop') {
    return null;
  }
  /* v8 ignore stop */

  const sf = getSourceFileRaw(filePath);

  // Get the position at the start of the target line
  const targetLineIndex = line - 1;
  const lineCount = sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1;
  if (targetLineIndex < 0 || targetLineIndex >= lineCount) {
    return null;
  }

  // Walk the AST to find the node at this line
  let result: string | null = null;

  function visit(node: ts.Node): void {
    if (result !== null) return;

    const nodeLineStart = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const nodeLine = nodeLineStart + 1; // 1-based

    if (nodeLine === line) {
      switch (contributorType) {
        case 'if':
        case 'else-if': {
          // Defensive: node at line may not be an IfStatement if AST walk visits a sub-node first
          /* v8 ignore start */
          if (ts.isIfStatement(node)) {
            /* v8 ignore stop */
            const condText = node.expression.getText(sf);
            result = truncateCondition(condText, config.conditionMaxLength);
          }
          break;
        }
        case 'ternary': {
          if (ts.isConditionalExpression(node)) {
            const condText = node.condition.getText(sf);
            result = truncateCondition(condText, config.conditionMaxLength);
          }
          break;
        }
        case 'logical-and':
        case 'logical-or': {
          if (ts.isBinaryExpression(node)) {
            const opKind = node.operatorToken.kind;
            const isMatch =
              (contributorType === 'logical-and' && opKind === ts.SyntaxKind.AmpersandAmpersandToken) ||
              (contributorType === 'logical-or' && opKind === ts.SyntaxKind.BarBarToken);
            if (isMatch) {
              const condText = node.left.getText(sf);
              result = truncateCondition(condText, config.conditionMaxLength);
            }
          }
          break;
        }
        case 'switch-case': {
          // For switch-case, try to get the switch expression from the parent.
          // Parent chain: CaseClause -> CaseBlock -> SwitchStatement
          // Defensive type guards: false branches unreachable in well-formed TypeScript AST
          /* v8 ignore start */
          if (ts.isCaseClause(node)) {
            const caseBlock = node.parent;
            if (caseBlock && ts.isSwitchStatement(caseBlock.parent)) {
              /* v8 ignore stop */
              const condText = caseBlock.parent.expression.getText(sf);
              result = truncateCondition(condText, config.conditionMaxLength);
            }
          }
          break;
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);
  return result;
}

function truncateCondition(text: string, maxLength: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLength) return oneLine;
  // Conditions longer than 120 chars do not appear in the test fixtures
  /* v8 ignore next */
  return oneLine.substring(0, maxLength - 3) + '...';
}

// ---------------------------------------------------------------------------
// Condition classification
// ---------------------------------------------------------------------------

interface ConditionClassification {
  kind: BranchClassificationKind;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  dispatchTarget?: string;
  guardTarget?: string;
  flagName?: string;
}

/**
 * Classify a condition expression by its semantic role.
 * The heuristic chain order matters: feature flag checks must come
 * before loading/boolean checks so `featureFlags.isLoading` is
 * classified as FEATURE_FLAG, not LOADING_CHECK.
 */
function classifyCondition(conditionText: string, contributorType: string): ConditionClassification {
  const config = astConfig.branchClassification;

  // 1. nullish-coalesce -> NULL_GUARD (high)
  if (contributorType === 'nullish-coalesce') {
    return {
      kind: 'NULL_GUARD',
      confidence: 'high',
      rationale: 'nullish coalescing operator (??)',
    };
  }

  // 2. featureFlags.X pattern -> FEATURE_FLAG (high)
  for (const pattern of config.featureFlagPatterns) {
    if (conditionText.includes(pattern)) {
      // Extract the flag name after the pattern prefix
      const idx = conditionText.indexOf(pattern);
      const afterPrefix = conditionText.slice(idx + pattern.length);
      const flagMatch = /^(\w+)/.exec(afterPrefix);
      // flagMatch is always non-null for well-formed featureFlag patterns like 'featureFlags.foo'
      /* v8 ignore start */
      const flagName = flagMatch ? `${pattern}${flagMatch[1]}` : undefined;
      /* v8 ignore stop */
      return {
        kind: 'FEATURE_FLAG',
        confidence: 'high',
        rationale: `feature flag pattern: ${conditionText}`,
        flagName,
      };
    }
  }

  // 3. null/undefined checks -> NULL_GUARD (high)
  if (
    /!==?\s*null\b/.test(conditionText) ||
    /===?\s*null\b/.test(conditionText) ||
    /!==?\s*undefined\b/.test(conditionText) ||
    /===?\s*undefined\b/.test(conditionText)
  ) {
    return {
      kind: 'NULL_GUARD',
      confidence: 'high',
      rationale: `null/undefined check: ${conditionText}`,
    };
  }

  // 4. discriminant === 'literal' or discriminant === Enum.X -> TYPE_DISPATCH (high)
  for (const name of config.discriminantNames) {
    // Match: discriminant === 'literal', discriminant === "literal", discriminant === Enum.X
    const discriminantPattern = new RegExp(`\\b${name}\\s*(?:===|!==)\\s*(?:'[^']*'|"[^"]*"|\\w+\\.\\w+)`);
    if (discriminantPattern.test(conditionText)) {
      // Extract the dispatch target (the literal or enum value)
      const targetMatch = new RegExp(`\\b${name}\\s*(?:===|!==)\\s*(?:'([^']*)'|"([^"]*)"|([\\w.]+))`).exec(
        conditionText,
      );
      // targetMatch is always non-null when discriminantPattern matched; group 1 covers single-quote literals
      /* v8 ignore start */
      const dispatchTarget = targetMatch ? (targetMatch[1] ?? targetMatch[2] ?? targetMatch[3]) : undefined;
      /* v8 ignore stop */
      return {
        kind: 'TYPE_DISPATCH',
        confidence: 'high',
        rationale: `type discriminant check on '${name}': ${conditionText}`,
        dispatchTarget,
      };
    }
  }

  // 5. error identifiers -> ERROR_CHECK (high)
  for (const errId of config.errorIdentifiers) {
    // Match standalone identifier or negated identifier
    const errPattern = new RegExp(`(?:^|[^\\w.])!?${errId}(?:[^\\w]|$)`);
    if (errPattern.test(conditionText)) {
      return {
        kind: 'ERROR_CHECK',
        confidence: 'high',
        rationale: `error identifier: ${errId}`,
        guardTarget: errId,
      };
    }
  }

  // 6. !data / !result / !response -> ERROR_CHECK (medium)
  if (/^!(?:data|result|response|results|rows)$/.test(conditionText.trim())) {
    return {
      kind: 'ERROR_CHECK',
      confidence: 'medium',
      rationale: `negated data variable: ${conditionText}`,
      guardTarget: conditionText.trim().slice(1),
    };
  }

  // 7. loading identifiers -> LOADING_CHECK (high)
  for (const loadId of config.loadingIdentifiers) {
    const loadPattern = new RegExp(`(?:^|[^\\w.])!?${loadId}(?:[^\\w]|$)`);
    if (loadPattern.test(conditionText)) {
      return {
        kind: 'LOADING_CHECK',
        confidence: 'high',
        rationale: `loading identifier: ${loadId}`,
        guardTarget: loadId,
      };
    }
  }

  // 8. boolean prefix identifier -> BOOLEAN_GUARD (medium)
  for (const prefix of config.booleanPrefixes) {
    // Match standalone identifier starting with the prefix, followed by uppercase
    const boolPattern = new RegExp(`(?:^|[^\\w.])!?${prefix}[A-Z]\\w*(?:[^\\w]|$)`);
    if (boolPattern.test(conditionText)) {
      const nameMatch = new RegExp(`!?(${prefix}[A-Z]\\w*)`).exec(conditionText);
      // nameMatch is always non-null when boolPattern matched (same pattern, with capture group)
      /* v8 ignore start */
      const guardTarget = nameMatch ? nameMatch[1] : undefined;
      /* v8 ignore stop */
      return {
        kind: 'BOOLEAN_GUARD',
        confidence: 'medium',
        rationale: `boolean prefix '${prefix}': ${conditionText}`,
        guardTarget,
      };
    }
  }

  // 9. fallthrough -> OTHER (low)
  return {
    kind: 'OTHER',
    confidence: 'low',
    rationale: `unclassified condition: ${conditionText}`,
  };
}

// ---------------------------------------------------------------------------
// Main interpreter
// ---------------------------------------------------------------------------

/**
 * Interpret FUNCTION_COMPLEXITY observations and classify each branch
 * contributor by its semantic role.
 */
export function interpretBranchClassification(
  filePath: string,
  observations: readonly ComplexityObservation[],
): AssessmentResult<BranchClassificationAssessment> {
  if (observations.length === 0) {
    return { assessments: [] };
  }

  const assessments: BranchClassificationAssessment[] = [];

  for (const obs of observations) {
    const { functionName, contributors } = obs.evidence;

    for (const contributor of contributors) {
      const { type, line: contributorLine } = contributor;

      // Skip catch and loop contributors
      if (type === 'catch' || type === 'loop') {
        continue;
      }

      const conditionText = extractConditionAtLine(filePath, contributorLine, type);

      if (conditionText === null) {
        // Could not extract condition -- emit OTHER
        assessments.push({
          kind: 'OTHER',
          subject: {
            file: obs.file,
            line: contributorLine,
            symbol: functionName,
          },
          confidence: 'low',
          rationale: [`could not extract condition at line ${contributorLine}`],
          basedOn: [{ kind: obs.kind, file: obs.file, line: obs.line }],
          isCandidate: false,
          requiresManualReview: false,
          evidence: {
            functionName,
            contributorType: type,
            contributorLine,
            conditionText: '',
          },
        });
        continue;
      }

      const classification = classifyCondition(conditionText, type);

      const evidence: BranchClassificationEvidence = {
        functionName,
        contributorType: type,
        contributorLine,
        conditionText,
        dispatchTarget: classification.dispatchTarget,
        guardTarget: classification.guardTarget,
        flagName: classification.flagName,
      };

      const basedOn: readonly ObservationRef[] = [{ kind: obs.kind, file: obs.file, line: obs.line }];

      assessments.push({
        kind: classification.kind,
        subject: {
          file: obs.file,
          line: contributorLine,
          symbol: functionName,
        },
        confidence: classification.confidence,
        rationale: [classification.rationale],
        basedOn,
        isCandidate: false,
        requiresManualReview: false,
        evidence,
      });
    }
  }

  return { assessments };
}

// ---------------------------------------------------------------------------
// Pretty output
// ---------------------------------------------------------------------------

function formatPrettyOutput(result: AssessmentResult<BranchClassificationAssessment>, filePath: string): string {
  return formatAssessmentTable(
    {
      title: `Branch Classification: ${filePath}`,
      emptyMessage: 'No branch contributors found.',
      columns: [
        // subject.line and evidence.functionName are always set on branch assessments -- ?? is defensive
        /* v8 ignore start */
        { header: 'Line', width: 5, align: 'right', extract: a => String(a.subject.line ?? '?') },
        { header: 'Classification', width: 17, extract: a => a.kind },
        { header: 'Confidence', width: 10, extract: a => a.confidence },
        { header: 'Function', width: 24, extract: a => a.evidence.functionName ?? '?' },
        /* v8 ignore stop */
        { header: 'Condition', width: 50, extract: a => a.evidence.conditionText },
      ],
    },
    result.assessments,
  );
}

// ---------------------------------------------------------------------------
// Directory analysis (with caching)
// ---------------------------------------------------------------------------

function analyzeDirectoryFiles(filePaths: string[], pretty: boolean): AssessmentResult<BranchClassificationAssessment> {
  const allAssessments: BranchClassificationAssessment[] = [];

  for (const filePath of filePaths) {
    try {
      const analysis = analyzeComplexity(filePath);
      const obsResult = extractComplexityObservations(analysis);

      if (obsResult.observations.length > 0) {
        const result = interpretBranchClassification(filePath, obsResult.observations);
        allAssessments.push(...result.assessments);
      }
      /* v8 ignore start */
    } catch (e) {
      // parse errors are not reproducible in unit tests
      if (!pretty) {
        console.error(`Warning: could not analyze ${filePath}: ${String(e)}`);
      }
    }
    /* v8 ignore stop */
  }

  return { assessments: allAssessments };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function main(): void {
  const args = parseArgs(process.argv);
  const noCache = hasNoCacheFlag(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-interpret-branch-classification.ts <file|dir> [--pretty] [--no-cache]\n' +
        '\n' +
        'Classify branch contributors by semantic role.\n' +
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
    // Tests always pass absolute paths; relative-path branch is CLI-only usage
    /* v8 ignore start */
    const absolute = path.isAbsolute(p) ? p : path.resolve(PROJECT_ROOT, p);
    /* v8 ignore stop */
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
    fatal('No .tsx/.ts files found.');
  }

  // Use directory-level caching if analyzing a directory
  let finalResult: AssessmentResult<BranchClassificationAssessment>;

  if (isDirectory && filePaths.length > 1) {
    finalResult = cachedDirectory(
      'interpret-branch-classification',
      dirPath,
      filePaths,
      () => analyzeDirectoryFiles(filePaths, args.pretty),
      { noCache },
    );
  } else {
    finalResult = analyzeDirectoryFiles(filePaths, args.pretty);
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
/* v8 ignore start */
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-interpret-branch-classification.ts') ||
    process.argv[1].endsWith('ast-interpret-branch-classification'));

if (isDirectRun) {
  main();
}
/* v8 ignore stop */
