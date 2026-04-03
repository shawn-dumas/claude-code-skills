/**
 * AST NR Client Tool
 *
 * Detects New Relic browser agent (NREUM) integration patterns and gaps
 * in client-side code. Identifies both existing NR call sites and locations
 * where NR integration is missing.
 */

import fs from 'fs';
import path from 'path';
import { Node, SyntaxKind } from 'ts-morph';
import { getSourceFile, PROJECT_ROOT } from './project';
import { runObservationToolCli, type ObservationToolConfig } from './cli-runner';
import { getFilesInDirectory, truncateText, getContainingFunctionName, type FileFilter } from './shared';
import { cached } from './ast-cache';
import type { NrClientAnalysis, NrClientObservation, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Known NR wrapper functions and NREUM methods
// ---------------------------------------------------------------------------

const NREUM_METHODS = new Set(['noticeError', 'addPageAction', 'setCustomAttribute', 'setPageViewName', 'interaction']);

// ---------------------------------------------------------------------------
// Detection: existing NR integration (positive observations)
// ---------------------------------------------------------------------------

function detectNreumCalls(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isPropertyAccessExpression(node)) return;

    const text = node.getText();

    // window.NREUM.* or NREUM.*
    if (text.startsWith('window.NREUM.') || text.startsWith('NREUM.')) {
      const parts = text.split('.');
      const methodName = parts[parts.length - 1];
      if (NREUM_METHODS.has(methodName)) {
        observations.push({
          kind: 'NR_NREUM_CALL',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            nreumMethod: methodName,
            containingFunction: getContainingFunctionName(node),
            callSite: truncateText(text, 80),
          },
        });
      }
    }
  });

  return observations;
}

function detectWrapperCalls(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const callName = Node.isIdentifier(expr) ? expr.getText() : '';

    if (callName === 'reportErrorToNewRelic') {
      observations.push({
        kind: 'NR_REPORT_ERROR_CALL',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          wrapperFunction: callName,
          containingFunction: getContainingFunctionName(node),
          callSite: truncateText(node.getText(), 80),
        },
      });
    } else if (callName === 'monitorApiCall') {
      observations.push({
        kind: 'NR_MONITOR_API_CALL',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          wrapperFunction: callName,
          containingFunction: getContainingFunctionName(node),
          callSite: truncateText(node.getText(), 80),
        },
      });
    }
  });

  return observations;
}

function detectRouteTracker(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];

  // Detect NewRelicRouteTracker usage or setPageViewName calls
  sf.forEachDescendant(node => {
    if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
      const tagName = node.getTagNameNode().getText();
      if (tagName === 'NewRelicRouteTracker') {
        observations.push({
          kind: 'NR_ROUTE_TRACKER',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            componentName: tagName,
          },
        });
      }
    }
  });

  return observations;
}

function detectScriptInjection(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];

  // Check for NREUM script tag in _document.tsx
  const text = sf.getFullText();
  if (text.includes('NREUM') && (text.includes('dangerouslySetInnerHTML') || text.includes('<script'))) {
    observations.push({
      kind: 'NR_SCRIPT_INJECTION',
      file: relativePath,
      line: 1,
      evidence: {
        reason: 'NREUM browser agent script injection detected',
      },
    });
  }

  return observations;
}

/**
 * Detect createTracer misuse: async work started before the interaction/tracer
 * is created, so the tracer callback only attaches listeners to an already-
 * running promise instead of wrapping the actual async operation.
 *
 * Pattern detected:
 *   const resultPromise = apiCall();   // async work starts here
 *   const interaction = NREUM.interaction();
 *   interaction.createTracer(name, () => {
 *     resultPromise.then(...)          // tracer references pre-started work
 *   });
 */
function detectTracerMisuse(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;
    if (expr.getName() !== 'createTracer') return;

    // Found a createTracer call. Get the callback argument (second arg).
    const args = node.getArguments();
    if (args.length < 2) return;
    const callback = args[1];
    if (!Node.isArrowFunction(callback) && !Node.isFunctionExpression(callback)) return;

    // Collect identifiers referenced in the callback body.
    const callbackBody = callback.getBody();
    const referencedIds = new Set<string>();
    callbackBody.forEachDescendant(inner => {
      if (Node.isIdentifier(inner)) {
        referencedIds.add(inner.getText());
      }
    });

    if (referencedIds.size === 0) return;

    // Walk up to the containing function/block to find variable declarations
    // that were assigned before the interaction() call.
    const containingFn =
      node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
      node.getFirstAncestorByKind(SyntaxKind.FunctionExpression) ??
      node.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
      node.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);

    if (!containingFn) return;

    // Find the interaction() call line to establish the boundary.
    const interactionCallLine = findInteractionCallLine(node);
    if (interactionCallLine === null) return;

    // Check variable declarations in the containing function that are:
    // (a) assigned via a call expression (likely async)
    // (b) declared before the interaction() line
    // (c) referenced in the tracer callback
    containingFn.forEachDescendant(inner => {
      if (!Node.isVariableDeclaration(inner)) return;
      const initLine = inner.getStartLineNumber();
      if (initLine >= interactionCallLine) return;

      const varName = inner.getName();
      if (!referencedIds.has(varName)) return;

      const initializer = inner.getInitializer();
      if (!initializer) return;

      // The initializer should be a call expression (the pre-started async work)
      if (Node.isCallExpression(initializer) || Node.isAwaitExpression(initializer)) {
        observations.push({
          kind: 'NR_TRACER_MISUSE',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            containingFunction: getContainingFunctionName(node),
            preStartedVariable: varName,
            interactionLine: interactionCallLine,
            reason: `createTracer callback references '${varName}' which was assigned via a call expression on line ${initLine}, before interaction() on line ${interactionCallLine}. The async work is not wrapped by the tracer.`,
          },
        });
      }
    });
  });

  return observations;
}

/** Find the line of the NREUM.interaction() call that produced the object createTracer is called on. */
function findInteractionCallLine(createTracerCall: import('ts-morph').CallExpression): number | null {
  const expr = createTracerCall.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return null;

  const obj = expr.getExpression();

  // Direct: NREUM.interaction().createTracer(...)
  if (Node.isCallExpression(obj)) {
    const innerText = obj.getExpression().getText();
    if (innerText.includes('interaction')) {
      return obj.getStartLineNumber();
    }
  }

  // Indirect: const interaction = NREUM.interaction(); interaction.createTracer(...)
  if (Node.isIdentifier(obj)) {
    const varName = obj.getText();
    const containingFn =
      createTracerCall.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ??
      createTracerCall.getFirstAncestorByKind(SyntaxKind.FunctionExpression) ??
      createTracerCall.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ??
      createTracerCall.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
    if (!containingFn) return null;

    let foundLine: number | null = null;
    containingFn.forEachDescendant(n => {
      if (foundLine !== null) return;
      if (!Node.isVariableDeclaration(n)) return;
      if (n.getName() !== varName) return;
      const init = n.getInitializer();
      if (init && Node.isCallExpression(init) && init.getExpression().getText().includes('interaction')) {
        foundLine = init.getStartLineNumber();
      }
    });
    return foundLine;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Detection: missing NR integration (gap observations)
// ---------------------------------------------------------------------------

/**
 * Check if ErrorBoundary or catch blocks lack NR error reporting.
 * Scans for componentDidCatch and catch blocks that use console.error
 * without also calling reportErrorToNewRelic or NREUM.noticeError.
 *
 * Excludes NR utility files (newrelic/) since their catch blocks
 * intentionally fall back to console.error when NR itself fails.
 */
function detectMissingErrorHandlers(filePath: string, relativePath: string): NrClientObservation[] {
  // Skip NR utility files -- their internal catch blocks are intentional fallbacks
  if (relativePath.includes('newrelic/')) return [];

  const sf = getSourceFile(filePath);
  const observations: NrClientObservation[] = [];
  const fullText = sf.getFullText();

  // Check catch blocks for console.error without NR reporting
  sf.forEachDescendant(node => {
    if (!Node.isCatchClause(node)) return;

    const blockText = node.getBlock().getText();
    const hasConsoleError = blockText.includes('console.error');
    const hasNrReport =
      blockText.includes('reportErrorToNewRelic') || blockText.includes('noticeError') || blockText.includes('NREUM');

    if (hasConsoleError && !hasNrReport) {
      observations.push({
        kind: 'NR_MISSING_ERROR_HANDLER',
        file: relativePath,
        line: node.getStartLineNumber(),
        evidence: {
          containingFunction: getContainingFunctionName(node),
          reason: 'catch block has console.error but no NR error reporting',
        },
      });
    }
  });

  // Check for componentDidCatch without NR reporting
  if (fullText.includes('componentDidCatch')) {
    sf.forEachDescendant(node => {
      if (!Node.isMethodDeclaration(node)) return;
      if (node.getName() !== 'componentDidCatch') return;

      const bodyText = node.getBody()?.getText() ?? '';
      const hasNrReport =
        bodyText.includes('reportErrorToNewRelic') || bodyText.includes('noticeError') || bodyText.includes('NREUM');

      if (!hasNrReport) {
        observations.push({
          kind: 'NR_MISSING_ERROR_HANDLER',
          file: relativePath,
          line: node.getStartLineNumber(),
          evidence: {
            containingFunction: 'componentDidCatch',
            reason: 'componentDidCatch does not report to New Relic',
          },
        });
      }
    });
  }

  return observations;
}

/**
 * Check if auth flow sets user ID as NR custom attribute.
 * Looks for files that call signInWith* or set auth state without
 * also calling NREUM.setCustomAttribute('userId', ...).
 */
function detectMissingUserId(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const fullText = sf.getFullText();
  const observations: NrClientObservation[] = [];

  // Only check files that deal with auth state
  const authIndicators = ['onAuthStateChanged', 'signInWith', 'onIdTokenChanged', 'useAuthState'];
  const hasAuthCode = authIndicators.some(indicator => fullText.includes(indicator));
  if (!hasAuthCode) return observations;

  const hasNrUserId =
    fullText.includes("setCustomAttribute('userId'") ||
    fullText.includes('setCustomAttribute("userId"') ||
    fullText.includes("setCustomAttribute('user_id'") ||
    fullText.includes('setCustomAttribute("user_id"');

  if (!hasNrUserId) {
    observations.push({
      kind: 'NR_MISSING_USER_ID',
      file: relativePath,
      line: 1,
      evidence: {
        reason: 'Auth flow file does not set userId as NR custom attribute',
      },
    });
  }

  return observations;
}

/**
 * Check if page files use NR route tracking.
 * This is a project-level check -- we only flag this once if the
 * route tracker component is not found in _app.tsx or its direct imports.
 *
 * Checks one level deep: if _app.tsx imports Providers.tsx and Providers.tsx
 * contains NewRelicRouteTracker, the route tracker is present (no false positive).
 */
function detectMissingRouteTracking(filePath: string, relativePath: string): NrClientObservation[] {
  // Only check _app.tsx
  if (!relativePath.endsWith('_app.tsx') && !relativePath.endsWith('_app.ts')) {
    return [];
  }

  if (fileTreeContainsSignal(filePath, hasRouteTrackerSignal, 2)) return [];

  return [
    {
      kind: 'NR_MISSING_ROUTE_TRACK',
      file: relativePath,
      line: 1,
      evidence: {
        pageFile: relativePath,
        reason: '_app does not include NewRelicRouteTracker or setPageViewName (checked imports 2 levels deep)',
      },
    },
  ];
}

function hasRouteTrackerSignal(text: string): boolean {
  return text.includes('NewRelicRouteTracker') || text.includes('setPageViewName');
}

/**
 * Check whether a file or any of its imports (up to `depth` levels) contains
 * content matching the `check` predicate. Used to look through barrel re-exports
 * without scanning the entire codebase.
 */
function fileTreeContainsSignal(
  filePath: string,
  check: (text: string) => boolean,
  depth: number,
  visited = new Set<string>(),
): boolean {
  if (depth < 0 || visited.has(filePath)) return false;
  visited.add(filePath);

  let text: string;
  try {
    text = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return false;
  }

  if (check(text)) return true;
  if (depth === 0) return false;

  // Extract import specifiers from the file and recurse.
  // Use a lightweight regex instead of ts-morph to avoid adding files to the project.
  const importRegex = /from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(text)) !== null) {
    const specifier = match[1];
    const resolved = resolveModuleSpecifier(specifier, filePath);
    if (resolved && fileTreeContainsSignal(resolved, check, depth - 1, visited)) {
      return true;
    }
  }

  return false;
}

const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

/** Resolve a module specifier to an absolute file path, handling @/ alias and relative paths. */
function resolveModuleSpecifier(specifier: string, fromFile: string): string | null {
  const fromDir = path.dirname(fromFile);

  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return findWithExtensions(path.resolve(fromDir, specifier));
  }

  // @/* -> src/ui/* (catch-all alias from tsconfig)
  if (specifier.startsWith('@/')) {
    const suffix = specifier.slice(2);
    // Try specific aliases first, then catch-all
    for (const [prefix, dir] of [
      ['shared/', 'src/shared/'],
      ['server/', 'src/server/'],
      ['pages/', 'src/pages/'],
      ['fixtures/', 'src/fixtures/'],
      ['root/', ''],
    ] as const) {
      if (suffix.startsWith(prefix)) {
        const sub = suffix.slice(prefix.length);
        const candidate = findWithExtensions(path.join(PROJECT_ROOT, dir, sub));
        if (candidate) return candidate;
      }
    }
    // Catch-all: @/* -> src/ui/*
    return findWithExtensions(path.join(PROJECT_ROOT, 'src/ui', suffix));
  }

  return null;
}

function findWithExtensions(base: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = base + ext;
    if (fs.existsSync(candidate)) return candidate;
  }
  // base itself might already have an extension
  if (fs.existsSync(base)) return base;
  return null;
}

/**
 * Check if _app.tsx has global unhandled rejection/error listeners
 * that report to NR.
 */
function detectMissingUnhandledRejection(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const fullText = sf.getFullText();
  const observations: NrClientObservation[] = [];

  // Only check _app.tsx
  if (!relativePath.endsWith('_app.tsx') && !relativePath.endsWith('_app.ts')) {
    return observations;
  }

  const hasUnhandledRejection = fullText.includes('unhandledrejection');
  const hasGlobalError = fullText.includes("addEventListener('error'") || fullText.includes('addEventListener("error"');

  if (!hasUnhandledRejection && !hasGlobalError) {
    observations.push({
      kind: 'NR_MISSING_UNHANDLED_REJECTION',
      file: relativePath,
      line: 1,
      evidence: {
        pageFile: relativePath,
        reason: '_app has no global unhandledrejection or error event listeners',
      },
    });
  }

  return observations;
}

/**
 * Check if the project reports web vitals to NR.
 */
function detectMissingWebVitals(filePath: string, relativePath: string): NrClientObservation[] {
  const sf = getSourceFile(filePath);
  const fullText = sf.getFullText();
  const observations: NrClientObservation[] = [];

  // Only check _app.tsx
  if (!relativePath.endsWith('_app.tsx') && !relativePath.endsWith('_app.ts')) {
    return observations;
  }

  const hasWebVitals =
    fullText.includes('reportWebVitals') ||
    fullText.includes('web-vitals') ||
    fullText.includes('onLCP') ||
    fullText.includes('onINP') ||
    fullText.includes('onCLS');

  if (!hasWebVitals) {
    observations.push({
      kind: 'NR_MISSING_WEB_VITALS',
      file: relativePath,
      line: 1,
      evidence: {
        pageFile: relativePath,
        reason: '_app does not report web vitals (LCP, FID, CLS)',
      },
    });
  }

  return observations;
}

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

export function analyzeNrClient(filePath: string): NrClientAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const observations: NrClientObservation[] = [
    ...detectNreumCalls(absolute, relativePath),
    ...detectWrapperCalls(absolute, relativePath),
    ...detectRouteTracker(absolute, relativePath),
    ...detectScriptInjection(absolute, relativePath),
    ...detectTracerMisuse(absolute, relativePath),
    ...detectMissingErrorHandlers(absolute, relativePath),
    ...detectMissingUserId(absolute, relativePath),
    ...detectMissingRouteTracking(absolute, relativePath),
    ...detectMissingUnhandledRejection(absolute, relativePath),
    ...detectMissingWebVitals(absolute, relativePath),
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

function computeSummary(observations: NrClientObservation[]): NrClientAnalysis['summary'] {
  let nreumCalls = 0;
  let reportErrorCalls = 0;
  let monitorApiCalls = 0;
  let missingCount = 0;

  for (const obs of observations) {
    switch (obs.kind) {
      case 'NR_NREUM_CALL':
      case 'NR_ROUTE_TRACKER':
      case 'NR_SCRIPT_INJECTION':
        nreumCalls++;
        break;
      case 'NR_REPORT_ERROR_CALL':
        reportErrorCalls++;
        break;
      case 'NR_MONITOR_API_CALL':
        monitorApiCalls++;
        break;
      case 'NR_TRACER_MISUSE':
        // Misuse is incorrect integration, not missing integration.
        // Counted toward missingCount for gap reporting purposes.
        break;
      case 'NR_MISSING_ERROR_HANDLER':
      case 'NR_MISSING_USER_ID':
      case 'NR_MISSING_ROUTE_TRACK':
      case 'NR_MISSING_UNHANDLED_REJECTION':
      case 'NR_MISSING_WEB_VITALS':
        missingCount++;
        break;
    }
  }

  return { nreumCalls, reportErrorCalls, monitorApiCalls, missingCount };
}

// ---------------------------------------------------------------------------
// Directory analysis
// ---------------------------------------------------------------------------

export function analyzeNrClientDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): NrClientAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: NrClientAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-nr-client', fp, () => analyzeNrClient(fp), options);
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

export function extractNrClientObservations(analysis: NrClientAnalysis): ObservationResult<NrClientObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const HELP_TEXT =
  'Usage: npx tsx scripts/AST/ast-nr-client.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
  '\n' +
  'Detect New Relic browser agent (NREUM) integration patterns and gaps.\n' +
  '\n' +
  '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
  '  --pretty      Format JSON output with indentation\n' +
  '  --no-cache    Bypass cache and recompute\n' +
  '  --test-files  Scan test files instead of production files\n' +
  '  --kind        Filter observations to a specific kind\n' +
  '  --count       Output observation kind counts instead of full data\n';

export const cliConfig: ObservationToolConfig<NrClientAnalysis> = {
  cacheNamespace: 'ast-nr-client',
  helpText: HELP_TEXT,
  analyzeFile: analyzeNrClient,
  analyzeDirectory: analyzeNrClientDirectory,
};

/* v8 ignore next 3 */
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-nr-client.ts') || process.argv[1].endsWith('ast-nr-client'));
if (isDirectRun) runObservationToolCli(cliConfig);
