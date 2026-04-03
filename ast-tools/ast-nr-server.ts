/**
 * AST NR Server Tool
 *
 * Detects New Relic server APM integration patterns and gaps in BFF
 * handler and middleware code. Identifies both existing NR call sites
 * and locations where NR integration is missing.
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
// Known NR APM identifiers
// ---------------------------------------------------------------------------

const NR_APM_MODULES = new Set(['newrelic']);

/** DB query method patterns. */
const DB_QUERY_METHODS = new Set(['query', 'select', 'insert', 'update', 'delete', 'execute', 'exec']);

// ---------------------------------------------------------------------------
// Detection: existing NR integration (positive observations)
// ---------------------------------------------------------------------------

function detectApmImports(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  for (const importDecl of sf.getImportDeclarations()) {
    const moduleSpec = importDecl.getModuleSpecifierValue();
    if (NR_APM_MODULES.has(moduleSpec)) {
      observations.push({
        kind: 'NR_APM_IMPORT',
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

function detectNoticeErrorCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    // newrelic.noticeError(...)
    if (text.endsWith('.noticeError') || text === 'noticeError') {
      observations.push({
        kind: 'NR_NOTICE_ERROR_CALL',
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

function detectCustomAttrsCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    if (text.endsWith('.addCustomAttributes') || text === 'addCustomAttributes') {
      observations.push({
        kind: 'NR_CUSTOM_ATTRS_CALL',
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

function detectCustomSegments(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    if (
      text.endsWith('.startSegment') ||
      text.endsWith('.startWebTransaction') ||
      text.endsWith('.startBackgroundTransaction')
    ) {
      observations.push({
        kind: 'NR_CUSTOM_SEGMENT',
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

function detectTxnNameCalls(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const text = expr.getText();

    if (text.endsWith('.setTransactionName') || text === 'setTransactionName') {
      observations.push({
        kind: 'NR_TXN_NAME_CALL',
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

// ---------------------------------------------------------------------------
// Detection: missing NR integration (gap observations)
// ---------------------------------------------------------------------------

/**
 * Check for catch blocks with console.error but no NR noticeError
 * in server middleware/handler files.
 */
function detectMissingErrorReport(filePath: string, relativePath: string): NrServerObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrServerObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCatchClause(node)) return;

    const blockText = node.getBlock().getText();
    const hasConsoleError = blockText.includes('console.error');
    const hasNrReport = blockText.includes('noticeError') || blockText.includes('newrelic');

    if (hasConsoleError && !hasNrReport) {
      observations.push({
        kind: 'NR_MISSING_ERROR_REPORT',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          containingFunction: getContainingFunctionName(node),
          catchBlockLine: node.getStartLineNumber(),
          errorSink: 'console.error',
          reason: 'Server catch block logs to console but does not report to NR APM',
        },
      });
    }
  });

  return observations;
}

/**
 * Check if auth middleware sets NR custom attributes (userId, organizationId).
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

  const hasNrAttrs = fullText.includes('addCustomAttributes') || fullText.includes('setCustomAttribute');

  if (!hasNrAttrs) {
    observations.push({
      kind: 'NR_MISSING_CUSTOM_ATTRS',
      file: relativePath,
      line: 1,
      evidence: {
        middleware: path.basename(relativePath, path.extname(relativePath)),
        reason: 'Auth middleware has userId but does not set NR custom attributes',
      },
    });
  }

  return observations;
}

/**
 * Check for database query calls without NR custom segment wrapping.
 * Only applies to ClickHouse (postgres auto-instruments via NR agent).
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

  // Check for query calls without startSegment wrapping
  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();
    if (!DB_QUERY_METHODS.has(methodName)) return;

    const objText = expr.getExpression().getText();
    // Check if there is a startSegment ancestor
    let parent: import('ts-morph').Node | undefined = node.getParent();
    let hasSegment = false;
    while (parent) {
      if (Node.isCallExpression(parent)) {
        const parentExpr = parent.getExpression();
        if (parentExpr.getText().includes('startSegment')) {
          hasSegment = true;
          break;
        }
      }
      parent = parent.getParent();
    }

    if (!hasSegment) {
      observations.push({
        kind: 'NR_MISSING_DB_SEGMENT',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          dbClient: objText,
          containingFunction: getContainingFunctionName(node),
          reason: `ClickHouse query call (${objText}.${methodName}) not wrapped in NR custom segment`,
        },
      });
    }
  });

  return observations;
}

/**
 * Check for dynamic API routes without custom transaction names.
 * Dynamic routes (e.g., [userId].ts) produce high-cardinality transaction
 * names without explicit setTransactionName.
 */
function detectMissingTxnName(filePath: string, relativePath: string): NrServerObservation[] {
  const observations: NrServerObservation[] = [];

  // Only check API route files with dynamic segments
  if (!relativePath.includes('pages/api/')) return observations;
  if (!relativePath.includes('[')) return observations;

  const sf = getSourceFile(filePath);
  const fullText = sf.getFullText();

  const hasSetTxnName = fullText.includes('setTransactionName');
  if (!hasSetTxnName) {
    observations.push({
      kind: 'NR_MISSING_TXN_NAME',
      file: relativePath,
      line: 1,
      evidence: {
        routePath: relativePath.replace(/^src\/pages/, '').replace(/\.tsx?$/, ''),
        reason: 'Dynamic API route without setTransactionName causes high-cardinality NR transactions',
      },
    });
  }

  return observations;
}

/**
 * Check for the NR APM startup hook required for auto-instrumentation.
 *
 * The NR Node.js agent must be loaded before any other module to instrument
 * pg, http, etc. In Next.js, this is done via instrumentation.ts (the
 * Next.js instrumentation hook) or NODE_OPTIONS='--require newrelic'.
 *
 * Scoped to withErrorHandler.ts (central error middleware) to produce
 * exactly one finding per scan.
 */
function detectMissingStartupHook(_filePath: string, relativePath: string): NrServerObservation[] {
  if (!relativePath.endsWith('middleware/withErrorHandler.ts')) return [];

  const candidates = ['instrumentation.ts', 'instrumentation.js', 'instrumentation.mjs'];
  const hasHook = candidates.some(name => fs.existsSync(path.join(PROJECT_ROOT, name)));

  if (hasHook) return [];

  return [
    {
      kind: 'NR_MISSING_STARTUP_HOOK',
      file: relativePath,
      line: 1,
      evidence: {
        checkedPaths: candidates.join(', '),
        reason:
          'No instrumentation.ts found at project root. NR APM agent requires early load via Next.js instrumentation hook or NODE_OPTIONS=--require newrelic.',
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
    ...detectApmImports(absolute, relativePath),
    ...detectNoticeErrorCalls(absolute, relativePath),
    ...detectCustomAttrsCalls(absolute, relativePath),
    ...detectCustomSegments(absolute, relativePath),
    ...detectTxnNameCalls(absolute, relativePath),
    ...detectMissingErrorReport(absolute, relativePath),
    ...detectMissingCustomAttrs(absolute, relativePath),
    ...detectMissingDbSegment(absolute, relativePath),
    ...detectMissingTxnName(absolute, relativePath),
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
  let apmImports = 0;
  let noticeErrorCalls = 0;
  let customAttrsCalls = 0;
  let missingCount = 0;

  for (const obs of observations) {
    switch (obs.kind) {
      case 'NR_APM_IMPORT':
        apmImports++;
        break;
      case 'NR_NOTICE_ERROR_CALL':
        noticeErrorCalls++;
        break;
      case 'NR_CUSTOM_ATTRS_CALL':
        customAttrsCalls++;
        break;
      case 'NR_CUSTOM_SEGMENT':
      case 'NR_TXN_NAME_CALL':
        // Positive integration signals -- counted in observations, not summarized
        break;
      case 'NR_MISSING_ERROR_REPORT':
      case 'NR_MISSING_CUSTOM_ATTRS':
      case 'NR_MISSING_DB_SEGMENT':
      case 'NR_MISSING_TXN_NAME':
      case 'NR_MISSING_STARTUP_HOOK':
        missingCount++;
        break;
    }
  }

  return { apmImports, noticeErrorCalls, customAttrsCalls, missingCount };
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
  'Detect New Relic server APM integration patterns and gaps.\n' +
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
