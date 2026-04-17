/**
 * AST Error Flow Tool
 *
 * Analyzes catch blocks to classify what happens with caught errors:
 * console.error, NR reporting, rethrow, swallowed, response, or callback.
 * Powers both the NR observability audit and general error handling audits.
 */

import path from 'path';
import { Node } from 'ts-morph';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import { cached } from './ast-cache';
import type {
  ErrorFlowAnalysis,
  ErrorFlowObservation,
  ErrorFlowObservationEvidence,
  ErrorSinkClassification,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Sink classification helpers
// ---------------------------------------------------------------------------

/** Identifiers that indicate New Relic error reporting (client or OTel). */
const NR_REPORT_FUNCTIONS = new Set(['reportErrorToNewRelic', 'noticeError', 'recordError']);

const NR_REPORT_METHODS = new Set(['noticeError']);

/** Patterns for console.* calls. */
const CONSOLE_METHODS = new Set(['error', 'warn', 'log', 'info', 'debug']);

/** Patterns indicating a response send (BFF handler error responses). */
const RESPONSE_METHODS = new Set(['json', 'send', 'end', 'status']);

function isConsoleCall(text: string): boolean {
  const match = /^console\.(\w+)/.exec(text);
  return match !== null && CONSOLE_METHODS.has(match[1]);
}

function isNrReportCall(text: string): boolean {
  // Direct: reportErrorToNewRelic(...)
  for (const fn of NR_REPORT_FUNCTIONS) {
    if (text.startsWith(fn + '(') || text === fn) return true;
  }
  // Method: window.NREUM.noticeError(...) or newrelic.noticeError(...)
  for (const method of NR_REPORT_METHODS) {
    if (text.includes('.' + method + '(') || text.includes('.' + method)) return true;
  }
  return false;
}

function isResponseCall(text: string): boolean {
  // res.status(...).json(...) or res.json(...) patterns
  if (text.startsWith('res.') || text.startsWith('response.')) {
    for (const method of RESPONSE_METHODS) {
      if (text.includes('.' + method + '(') || text.includes('.' + method)) return true;
    }
  }
  return false;
}

function isCallbackCall(text: string): boolean {
  // onError(...), reject(...), callback(err), next(err)
  return /^(onError|reject|callback|next)\s*\(/.test(text);
}

// ---------------------------------------------------------------------------
// Catch block analysis
// ---------------------------------------------------------------------------

interface CatchSink {
  sink: ErrorSinkClassification;
  expression: string;
}

function classifyCatchBlockSinks(catchClause: import('ts-morph').CatchClause): CatchSink[] {
  const sinks: CatchSink[] = [];
  const block = catchClause.getBlock();

  // Check if the block is empty (swallowed)
  const statements = block.getStatements();
  if (statements.length === 0) {
    sinks.push({ sink: 'swallowed', expression: '(empty catch block)' });
    return sinks;
  }

  let hasAnySink = false;

  // Walk all descendant statements (including inside nested if blocks)
  // but only match ExpressionStatement and ThrowStatement -- not nested
  // CallExpression nodes, which would double-count sub-expressions like
  // res.status(404) inside res.status(404).json(...).
  block.forEachDescendant(node => {
    if (Node.isThrowStatement(node)) {
      hasAnySink = true;
      sinks.push({
        sink: 'rethrow',
        expression: truncateText(node.getText(), 80),
      });
      return;
    }

    if (!Node.isExpressionStatement(node)) return;

    const text = node.getText();
    const truncated = truncateText(text, 120);

    if (isNrReportCall(text)) {
      hasAnySink = true;
      sinks.push({ sink: 'newrelic', expression: truncated });
    } else if (isConsoleCall(text)) {
      hasAnySink = true;
      sinks.push({ sink: 'console', expression: truncated });
    } else if (isResponseCall(text)) {
      hasAnySink = true;
      sinks.push({ sink: 'response', expression: truncated });
    } else if (isCallbackCall(text)) {
      hasAnySink = true;
      sinks.push({ sink: 'callback', expression: truncated });
    }
  });

  // If no sinks detected at all, the error is swallowed
  if (!hasAnySink) {
    sinks.push({ sink: 'swallowed', expression: '(no error sink in catch block)' });
  }

  return sinks;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeErrorFlow(filePath: string): ErrorFlowAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const sf = getSourceFile(absolute);

  const observations: ErrorFlowObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCatchClause(node)) return;

    const catchLine = node.getStartLineNumber();
    const containingFunction = getContainingFunctionName(node);
    const sinks = classifyCatchBlockSinks(node);
    const hasMultipleSinks = sinks.length > 1;

    for (const { sink, expression } of sinks) {
      const evidence: ErrorFlowObservationEvidence = {
        sink,
        catchLine,
        containingFunction,
        sinkExpression: expression,
        hasMultipleSinks: hasMultipleSinks || undefined,
      };

      observations.push({
        kind: 'ERROR_SINK_TYPE',
        file: relativePath,
        line: catchLine,
        evidence,
      });
    }
  });

  const summary = computeSummary(observations);

  return {
    filePath: relativePath,
    observations,
    summary,
  };
}

function computeSummary(observations: ErrorFlowObservation[]): Readonly<Record<ErrorSinkClassification, number>> {
  const summary: Record<ErrorSinkClassification, number> = {
    console: 0,
    newrelic: 0,
    rethrow: 0,
    swallowed: 0,
    response: 0,
    callback: 0,
  };

  for (const obs of observations) {
    summary[obs.evidence.sink]++;
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Directory analysis
// ---------------------------------------------------------------------------

export function analyzeErrorFlowDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): ErrorFlowAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: ErrorFlowAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-error-flow', fp, () => analyzeErrorFlow(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by total sinks descending
  results.sort((a, b) => b.observations.length - a.observations.length);

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction (for tool-registry)
// ---------------------------------------------------------------------------

export function extractErrorFlowObservations(analysis: ErrorFlowAnalysis): ObservationResult<ErrorFlowObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-error-flow.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Classify error sinks in catch blocks (console, newrelic, rethrow, swallowed, response, callback).\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<ErrorFlowAnalysis> = {
  cacheNamespace: 'ast-error-flow',
  helpText: HELP_TEXT,
  analyzeFile: analyzeErrorFlow,
  analyzeDirectory: analyzeErrorFlowDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-error-flow.ts') || process.argv[1].endsWith('ast-error-flow'));
if (isDirectRun) runObservationToolCli(cliConfig);
