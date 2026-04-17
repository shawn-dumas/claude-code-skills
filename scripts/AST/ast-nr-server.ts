/**
 * AST NR Server Tool
 *
 * Detects server-side observability patterns and gaps. NR is still the
 * observability platform, but the SDK layer is now OpenTelemetry (PR #1377).
 * The proprietary newrelic Node agent was replaced by:
 *   - otelTracer.ts: withSpan, recordError, setSpanAttributes
 *   - withChSegment.ts: ClickHouse span wrapper
 *   - instrumentation.ts + otel-instrumentation.js: SDK bootstrap
 *
 * Positive observations detect OTel call sites. Gap observations detect
 * locations where OTel integration is missing.
 */

import fs from 'fs';
import path from 'path';
import { Node } from 'ts-morph';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import { cached } from './ast-cache';
import type { NrServerAnalysis, NrServerObservation, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Known OTel module paths
// ---------------------------------------------------------------------------

const OTEL_MODULES = new Set(['@/server/lib/otelTracer', '@/server/lib/withChSegment', '@opentelemetry/api']);

/** OTel wrapper function names that indicate active observability. */
const OTEL_ERROR_FUNCTIONS = new Set(['recordError']);
const OTEL_ATTRS_FUNCTIONS = new Set(['setSpanAttributes']);
const OTEL_SPAN_FUNCTIONS = new Set(['withSpan', 'withChSegment']);

/** DB query method patterns. */
const DB_QUERY_METHODS = new Set(['query', 'select', 'insert', 'update', 'delete', 'execute', 'exec']);

// ---------------------------------------------------------------------------
// Detection: existing OTel integration (positive observations)
// ---------------------------------------------------------------------------

function detectOtelImports(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (OTEL_MODULES.has(moduleSpec)) {
      observations.push({
        kind: 'OTEL_TRACER_IMPORT',
        file: relativePath,
        line: importDecl.getStartLineNumber(),
        evidence: {
          callSite: truncateText(importDecl.getText(), 80),
        },
      });
    }
  }

  return observations;
}

function detectRecordErrorCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    // recordError(...) -- standalone or property access
    const fnName = text.includes('.') ? text.split('.').pop() : text;
    if (fnName && OTEL_ERROR_FUNCTIONS.has(fnName)) {
      observations.push({
        kind: 'OTEL_RECORD_ERROR_CALL',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          callSite: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
        },
      });
    }
  });

  return observations;
}

function detectSetAttrsCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    const fnName = text.includes('.') ? text.split('.').pop() : text;
    if (fnName && OTEL_ATTRS_FUNCTIONS.has(fnName)) {
      observations.push({
        kind: 'OTEL_SET_ATTRS_CALL',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          callSite: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
        },
      });
    }
  });

  return observations;
}

function detectSpanCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    const fnName = text.includes('.') ? text.split('.').pop() : text;
    if (fnName && OTEL_SPAN_FUNCTIONS.has(fnName)) {
      // Extract span name from first argument if it's a string literal
      const args = node.getArguments();
      let spanName: string | undefined;
      if (args[0] && Node.isStringLiteral(args[0])) {
        spanName = args[0].getLiteralText();
      } else if (args[0] && Node.isTemplateExpression(args[0])) {
        spanName = truncateText(args[0].getText(), 40);
      }

      observations.push({
        kind: 'OTEL_SPAN_CALL',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          callSite: truncateText(node.getText(), 80),
          containingFunction: getContainingFunctionName(node),
          spanName,
        },
      });
    }
  });

  return observations;
}

// ---------------------------------------------------------------------------
// Detection: missing OTel integration (gap observations)
// ---------------------------------------------------------------------------

/**
 * Check for catch blocks with console.error but no recordError
 * in server middleware/handler files.
 */
function detectMissingErrorReport(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCatchClause(node)) return;

    const blockText = node.getBlock().getText();
    const hasConsoleError = blockText.includes('console.error');
    const hasOtelReport = blockText.includes('recordError');

    if (hasConsoleError && !hasOtelReport) {
      observations.push({
        kind: 'NR_MISSING_ERROR_REPORT',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          containingFunction: getContainingFunctionName(node),
          catchBlockLine: node.getStartLineNumber(),
          errorSink: 'console.error',
          reason: 'Server catch block logs to console but does not call recordError',
        },
      });
    }
  });

  return observations;
}

/**
 * Check if auth middleware sets OTel span attributes (userId, organizationId).
 */
function detectMissingCustomAttrs(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const fullText = sf.getFullText();
  const observations: NrServerObservation[] = [];

  // Only check middleware files
  if (!relativePath.includes('middleware/')) return observations;

  // Check if this file handles auth (has userId/decoded.uid)
  const hasAuth = fullText.includes('decoded.uid') || fullText.includes('userId');
  if (!hasAuth) return observations;

  const hasOtelAttrs = fullText.includes('setSpanAttributes');

  if (!hasOtelAttrs) {
    observations.push({
      kind: 'NR_MISSING_CUSTOM_ATTRS',
      file: relativePath,
      line: 1,
      evidence: {
        middleware: path.basename(relativePath, path.extname(relativePath)),
        reason: 'Auth middleware has userId but does not call setSpanAttributes',
      },
    });
  }

  return observations;
}

/**
 * Check for database query calls without OTel span wrapping.
 * Only applies to ClickHouse (postgres auto-instruments via OTel SDK).
 */
function detectMissingDbSegment(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  // Only check files that import a ClickHouse client
  const hasClickhouseImport = sf.getImportDeclarations().some(decl => {
    const spec = decl.getModuleSpecifierValue();
    return spec.includes('clickhouse') || spec.includes('@clickhouse/client');
  });

  if (!hasClickhouseImport) return observations;

  // Check for query calls without withSpan/withChSegment wrapping
  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();
    if (!DB_QUERY_METHODS.has(methodName)) return;

    const objText = expr.getExpression().getText();
    // Check if there is a withSpan or withChSegment ancestor
    let parent: import('ts-morph').Node | undefined = node.getParent();
    let hasSpan = false;
    while (parent) {
      if (Node.isCallExpression(parent)) {
        const parentExpr = parent.getExpression();
        const parentText = parentExpr.getText();
        if (parentText.includes('withSpan') || parentText.includes('withChSegment')) {
          hasSpan = true;
          break;
        }
      }
      parent = parent.getParent();
    }

    if (!hasSpan) {
      observations.push({
        kind: 'NR_MISSING_DB_SEGMENT',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          dbClient: objText,
          containingFunction: getContainingFunctionName(node),
          reason: `ClickHouse query call (${objText}.${methodName}) not wrapped in withSpan/withChSegment`,
        },
      });
    }
  });

  return observations;
}

/**
 * Check for the OTel instrumentation hook required for auto-instrumentation.
 *
 * The OTel SDK must be loaded before any other module to instrument
 * http, pg, etc. In Next.js, this is done via instrumentation.ts (the
 * Next.js instrumentation hook) which imports otel-instrumentation.js.
 *
 * Scoped to withErrorHandler.ts (central error middleware) to produce
 * exactly one finding per scan.
 */
function detectMissingStartupHook(_filePath: string, relativePath: string): NrServerObservation[] {
  if (!relativePath.endsWith('middleware/withErrorHandler.ts')) return [];

  const candidates = [
    'instrumentation.ts',
    'instrumentation.js',
    'instrumentation.mjs',
    'src/instrumentation.ts',
    'src/instrumentation.js',
    'src/instrumentation.mjs',
  ];
  const hasHook = candidates.some(name => fs.existsSync(path.join(PROJECT_ROOT, name)));

  if (hasHook) return [];

  return [
    {
      kind: 'NR_MISSING_STARTUP_HOOK',
      file: relativePath,
      line: 1,
      evidence: {
        checkedPaths: candidates.join(', '),
        reason: 'No instrumentation.ts found. OTel SDK requires early load via Next.js instrumentation hook.',
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeNrServer(filePath: string): NrServerAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const observations: NrServerObservation[] = [
    ...detectOtelImports(absolute, relativePath),
    ...detectRecordErrorCalls(absolute, relativePath),
    ...detectSetAttrsCalls(absolute, relativePath),
    ...detectSpanCalls(absolute, relativePath),
    ...detectMissingErrorReport(absolute, relativePath),
    ...detectMissingCustomAttrs(absolute, relativePath),
    ...detectMissingDbSegment(absolute, relativePath),
    ...detectMissingStartupHook(absolute, relativePath),
  ];

  // Sort by line
  observations.sort((a, b) => a.line - b.line);

  const summary = computeSummary(observations);

  return {
    filePath: relativePath,
    observations,
    summary,
  };
}

function computeSummary(observations: NrServerObservation[]): NrServerAnalysis['summary'] {
  let otelImports = 0;
  let recordErrorCalls = 0;
  let setAttrsCalls = 0;
  let missingCount = 0;

  for (const obs of observations) {
    switch (obs.kind) {
      case 'OTEL_TRACER_IMPORT':
        otelImports++;
        break;
      case 'OTEL_RECORD_ERROR_CALL':
        recordErrorCalls++;
        break;
      case 'OTEL_SET_ATTRS_CALL':
        setAttrsCalls++;
        break;
      case 'OTEL_SPAN_CALL':
        // Positive integration signal -- counted in observations, not summarized
        break;
      case 'NR_MISSING_ERROR_REPORT':
      case 'NR_MISSING_CUSTOM_ATTRS':
      case 'NR_MISSING_DB_SEGMENT':
      case 'NR_MISSING_STARTUP_HOOK':
        missingCount++;
        break;
    }
  }

  return { otelImports, recordErrorCalls, setAttrsCalls, missingCount };
}

// ---------------------------------------------------------------------------
// Directory analysis
// ---------------------------------------------------------------------------

export function analyzeNrServerDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): NrServerAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: NrServerAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-nr-server', fp, () => analyzeNrServer(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by missing count descending
  results.sort((a, b) => b.summary.missingCount - a.summary.missingCount);

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction (for tool-registry)
// ---------------------------------------------------------------------------

export function extractNrServerObservations(analysis: NrServerAnalysis): ObservationResult<NrServerObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-nr-server.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Detect server-side OTel observability patterns and gaps (data exports to NR via OTLP).\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<NrServerAnalysis> = {
  cacheNamespace: 'ast-nr-server',
  helpText: HELP_TEXT,
  analyzeFile: analyzeNrServer,
  analyzeDirectory: analyzeNrServerDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-nr-server.ts') || process.argv[1].endsWith('ast-nr-server'));
if (isDirectRun) runObservationToolCli(cliConfig);
