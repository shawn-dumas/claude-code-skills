/**
 * AST tool: BFF Gap Analysis
 *
 * Scans API routes to identify BFF endpoint gaps -- mock routes without
 * corresponding BFF implementations, and BFF stubs returning 501.
 *
 * Detection:
 *   - BFF stubs: route files containing `res.status(501)` (chained call pattern)
 *   - Mock routes: files under `src/pages/api/mock/`
 *   - Missing BFF: mock route exists but no corresponding non-mock route
 *   - Query hook gaps: hooks whose fetchApi URL points at a stub or missing BFF
 *
 * Path correlation: strips `/mock/` from mock route paths to find the
 * expected BFF path. Works for all Next.js dynamic route segments.
 */

import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import { resolveConfig } from './ast-config';
import { getCacheStats } from './ast-cache';
import type {
  BffGapObservation,
  BffGapObservationKind,
  BffGapObservationEvidence,
  BffGapAnalysis,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

// Mock segment and stub patterns are configured in ast-config.ts under bffGaps.

/**
 * Convert a filesystem path to an API path.
 * e.g., src/pages/api/users/data-api/systems/teams.ts -> /api/users/data-api/systems/teams
 * e.g., src/pages/api/mock/users/data-api/systems/teams.ts -> /api/mock/users/data-api/systems/teams
 *
 * Handles index files: src/pages/api/mock/.../index.ts -> /api/mock/.../
 */
function filePathToApiPath(filePath: string): string {
  const relative = path.relative(PROJECT_ROOT, path.resolve(PROJECT_ROOT, filePath));
  // Strip src/pages and extension
  let apiPath = relative.replace(/^src\/pages/, '').replace(/\.(ts|tsx|js|jsx)$/, '');

  // Handle index files
  if (apiPath.endsWith('/index')) {
    apiPath = apiPath.slice(0, -'/index'.length) || '/';
  }

  return apiPath;
}

/**
 * Strip the mock segment from an API path to derive the expected BFF path.
 * /api/mock/users/data-api/systems/teams -> /api/users/data-api/systems/teams
 */
function mockPathToBffPath(mockApiPath: string): string {
  const config = resolveConfig();
  const mockSeg = config.bffGaps.mockSegment;
  // Replace first occurrence of /api{mockSegment} with /api/
  return mockApiPath.replace(`/api${mockSeg}`, '/api/');
}

/**
 * Convert an API path back to a relative file path.
 * /api/users/data-api/systems/teams -> src/pages/api/users/data-api/systems/teams.ts
 */
function apiPathToFilePath(apiPath: string): string {
  return `src/pages${apiPath}.ts`;
}

// ---------------------------------------------------------------------------
// BFF stub detection
// ---------------------------------------------------------------------------

interface BffRouteInfo {
  relativePath: string;
  apiPath: string;
  isStub: boolean;
  middleware: string[];
  todoComments: string[];
  httpMethods: string[];
}

/**
 * Analyze a single BFF route file to determine if it's a stub (501).
 */
function analyzeBffRoute(filePath: string): BffRouteInfo {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const apiPath = filePathToApiPath(relativePath);

  const sf = getSourceFile(absolute);
  const text = sf.getText();

  // Quick text pre-filter for stub detection (patterns from config)
  const config = resolveConfig();
  const isStub = config.bffGaps.stubPatterns.some(pattern => text.includes(pattern));

  // Extract middleware from default export chain
  const middleware = extractMiddleware(text);

  // Extract HTTP methods from withMethod
  const httpMethods = extractHttpMethods(text);

  // Extract TODO comments
  const todoComments: string[] = [];
  for (const range of sf.getLeadingCommentRanges()) {
    const commentText = text.substring(range.getPos(), range.getEnd());
    if (/TODO/i.test(commentText)) {
      todoComments.push(commentText.replace(/^\/\/\s*/, '').trim());
    }
  }
  // Also check all comments in the file
  sf.forEachDescendant(node => {
    for (const range of node.getLeadingCommentRanges()) {
      const commentText = text.substring(range.getPos(), range.getEnd());
      if (/TODO/i.test(commentText)) {
        const cleaned = commentText.replace(/^\/\/\s*/, '').trim();
        if (!todoComments.includes(cleaned)) {
          todoComments.push(cleaned);
        }
      }
    }
  });

  return { relativePath, apiPath, isStub, middleware, todoComments, httpMethods };
}

/**
 * Extract middleware names from the default export chain.
 * Pattern: export default withErrorHandler(withMethod(['POST'], withAuth(handler)))
 */
function extractMiddleware(text: string): string[] {
  const middleware: string[] = [];
  // Match withXxx( patterns in the default export
  const exportMatch = text.match(/export\s+default\s+(.+);?\s*$/m);
  if (exportMatch) {
    const chain = exportMatch[1];
    const withPattern = /with\w+/g;
    let match;
    while ((match = withPattern.exec(chain)) !== null) {
      middleware.push(match[0]);
    }
  }
  return middleware;
}

/**
 * Extract HTTP methods from withMethod call.
 * Pattern: withMethod(['POST'], ...)
 */
function extractHttpMethods(text: string): string[] {
  const methodMatch = text.match(/withMethod\(\[([^\]]+)\]/);
  if (methodMatch) {
    return methodMatch[1]
      .split(',')
      .map(m => m.trim().replace(/['"]/g, ''))
      .filter(Boolean);
  }
  return [];
}

// ---------------------------------------------------------------------------
// Mock route detection
// ---------------------------------------------------------------------------

interface MockRouteInfo {
  relativePath: string;
  apiPath: string;
  expectedBffPath: string;
  expectedBffFile: string;
  fixtureBuilders: string[];
}

/**
 * Analyze a mock route file to extract fixture builder calls.
 */
function analyzeMockRoute(filePath: string): MockRouteInfo {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);
  const apiPath = filePathToApiPath(relativePath);
  const expectedBffPath = mockPathToBffPath(apiPath);
  const expectedBffFile = apiPathToFilePath(expectedBffPath);

  // Extract fixture builder calls from the file
  const fixtureBuilders: string[] = [];
  const sf = getSourceFile(absolute);

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const callText = expr.getText();
    // Match build* and create* function calls from fixtures
    if (/^(build|create)[A-Z]/.test(callText)) {
      if (!fixtureBuilders.includes(callText)) {
        fixtureBuilders.push(callText);
      }
    }
  });

  return { relativePath, apiPath, expectedBffPath, expectedBffFile, fixtureBuilders };
}

// ---------------------------------------------------------------------------
// Cross-referencing with data layer
// ---------------------------------------------------------------------------

interface QueryHookGap {
  hookFile: string;
  hookName: string;
  fetchApiUrl: string;
  responseSchema: string | null;
}

/**
 * Find query hooks that reference endpoints matching the BFF gap paths.
 * Uses ast-data-layer's FETCH_API_CALL observations to cross-reference.
 */
function findQueryHookGaps(gapApiPaths: Set<string>, hookDirs: string[]): QueryHookGap[] {
  // Lazy import to avoid circular dependency at module level
  const { analyzeDataLayerDirectory } = require('./ast-data-layer') as typeof import('./ast-data-layer');

  const gaps: QueryHookGap[] = [];

  for (const hookDir of hookDirs) {
    const absolute = path.isAbsolute(hookDir) ? hookDir : path.resolve(PROJECT_ROOT, hookDir);
    if (!fs.existsSync(absolute)) continue;

    const analyses = analyzeDataLayerDirectory(hookDir);

    for (const analysis of analyses) {
      for (const usage of analysis.usages) {
        if (usage.type !== 'FETCH_API_CALL') continue;
        const url = usage.details.url;
        if (!url) continue;

        // Normalize URL: strip template expressions to get the base path
        // e.g., `/api/users/data-api/systems/confluence/${pageId}/events` -> /api/users/data-api/systems/confluence/[pageId]/events
        const normalizedUrl = url.replace(/`/g, '').replace(/\$\{[^}]+\}/g, match => {
          // Convert ${pageId} to [pageId]
          const varName = match.slice(2, -1).trim();
          return `[${varName}]`;
        });

        // Check if this URL matches any gap path
        for (const gapPath of gapApiPaths) {
          if (normalizedUrl === gapPath || normalizedUrl.includes(gapPath.replace('/api/', ''))) {
            // Find the containing hook name
            const hookName = findContainingHookName(analysis.filePath);

            gaps.push({
              hookFile: analysis.filePath,
              hookName,
              fetchApiUrl: url,
              responseSchema: usage.details.schema ?? null,
            });
            break;
          }
        }
      }
    }
  }

  return gaps;
}

/**
 * Derive the hook name from a file path.
 * src/ui/services/hooks/queries/insights/useConfluenceSummaryQuery/useConfluenceSummaryQuery.ts
 * -> useConfluenceSummaryQuery
 */
function findContainingHookName(filePath: string): string {
  const basename = path.basename(filePath, path.extname(filePath));
  if (basename.startsWith('use')) return basename;
  // Try parent directory name
  const dirName = path.basename(path.dirname(filePath));
  if (dirName.startsWith('use')) return dirName;
  return basename;
}

// ---------------------------------------------------------------------------
// Analysis orchestration
// ---------------------------------------------------------------------------

/**
 * Analyze a directory tree for BFF gaps.
 *
 * Scans for:
 *   1. BFF route files (non-mock) under the given path
 *   2. Mock route files under the corresponding mock/ path
 *   3. Cross-references with query hooks if hookDirs provided
 */
export function analyzeBffGaps(
  apiDirPath: string,
  options: { noCache?: boolean; hookDirs?: string[] } = {},
): BffGapAnalysis {
  const absolute = path.isAbsolute(apiDirPath) ? apiDirPath : path.resolve(PROJECT_ROOT, apiDirPath);
  const config = resolveConfig();
  const mockSeg = config.bffGaps.mockSegment;

  // Find all BFF (non-mock) route files
  const bffFiles = getFilesInDirectory(absolute).filter(f => !f.includes(mockSeg));

  // Find all mock route files under the corresponding mock directory
  // Derive mock dir: src/pages/api/ -> src/pages/api/mock/
  const mockDir = absolute.replace('/pages/api/', `/pages/api${mockSeg}`);
  const mockFiles = fs.existsSync(mockDir) ? getFilesInDirectory(mockDir) : [];

  // Analyze BFF routes
  // No caching: analysis results are path-specific (relativePath, apiPath).
  // The cache keys by content hash, and BFF stubs have identical content,
  // so caching would return the wrong path for all but the first stub.
  const bffRoutes: BffRouteInfo[] = bffFiles.map(f => analyzeBffRoute(f));

  // Analyze mock routes (same caching concern as BFF routes)
  const mockRoutes: MockRouteInfo[] = mockFiles.map(f => analyzeMockRoute(f));

  // Build lookup maps
  const bffByApiPath = new Map<string, BffRouteInfo>();
  for (const bff of bffRoutes) {
    bffByApiPath.set(bff.apiPath, bff);
  }

  const mockByExpectedBffPath = new Map<string, MockRouteInfo>();
  for (const mock of mockRoutes) {
    mockByExpectedBffPath.set(mock.expectedBffPath, mock);
  }

  // --- Cross-reference with query hooks FIRST (needed by BFF_STUB_ROUTE) ---

  // Collect all gap API paths (stubs + missing)
  const gapApiPaths = new Set<string>();
  for (const bff of bffRoutes) {
    if (bff.isStub) gapApiPaths.add(bff.apiPath);
  }
  for (const mock of mockRoutes) {
    if (!bffByApiPath.has(mock.expectedBffPath)) {
      gapApiPaths.add(mock.expectedBffPath);
    }
  }

  // Build schema lookup: apiPath -> { hookName, schema } from hook cross-reference
  const schemaByApiPath = new Map<string, { hookName: string; schema: string | null }>();
  let hookGaps: QueryHookGap[] = [];

  if (options.hookDirs && options.hookDirs.length > 0 && gapApiPaths.size > 0) {
    hookGaps = findQueryHookGaps(gapApiPaths, options.hookDirs);
    for (const gap of hookGaps) {
      // Normalize the fetchApi URL to match API paths
      const normalizedUrl = gap.fetchApiUrl.replace(/`/g, '').replace(/\$\{[^}]+\}/g, match => {
        const varName = match.slice(2, -1).trim();
        return `[${varName}]`;
      });

      // Find the matching gap API path
      for (const gapPath of gapApiPaths) {
        if (normalizedUrl === gapPath || normalizedUrl.includes(gapPath.replace('/api/', ''))) {
          schemaByApiPath.set(gapPath, { hookName: gap.hookName, schema: gap.responseSchema });
          break;
        }
      }
    }
  }

  // --- Generate observations ---
  const observations: BffGapObservation[] = [];

  // 1. Emit BFF_STUB_ROUTE for each stub (enriched with schema from hook cross-reference)
  for (const bff of bffRoutes) {
    if (!bff.isStub) continue;
    const correspondingMock = mockByExpectedBffPath.get(bff.apiPath);
    const schemaInfo = schemaByApiPath.get(bff.apiPath);
    observations.push({
      kind: 'BFF_STUB_ROUTE',
      file: bff.relativePath,
      line: 1,
      evidence: {
        apiPath: bff.apiPath,
        bffFile: bff.relativePath,
        mockFile: correspondingMock?.relativePath,
        middleware: bff.middleware,
        todoComments: bff.todoComments.length > 0 ? bff.todoComments : undefined,
        httpMethods: bff.httpMethods.length > 0 ? bff.httpMethods : undefined,
        responseSchema: schemaInfo?.schema ?? undefined,
        queryHookName: schemaInfo?.hookName,
      },
    });
  }

  // 2. Emit MOCK_ROUTE for each mock route
  for (const mock of mockRoutes) {
    observations.push({
      kind: 'MOCK_ROUTE',
      file: mock.relativePath,
      line: 1,
      evidence: {
        apiPath: mock.apiPath,
        mockFile: mock.relativePath,
        bffFile: bffByApiPath.has(mock.expectedBffPath)
          ? bffByApiPath.get(mock.expectedBffPath)!.relativePath
          : undefined,
        fixtureBuilders: mock.fixtureBuilders.length > 0 ? mock.fixtureBuilders : undefined,
      },
    });
  }

  // 3. Emit BFF_MISSING_ROUTE for mock routes without any BFF route
  for (const mock of mockRoutes) {
    if (bffByApiPath.has(mock.expectedBffPath)) continue;
    observations.push({
      kind: 'BFF_MISSING_ROUTE',
      file: mock.relativePath,
      line: 1,
      evidence: {
        apiPath: mock.expectedBffPath,
        mockFile: mock.relativePath,
        fixtureBuilders: mock.fixtureBuilders.length > 0 ? mock.fixtureBuilders : undefined,
      },
    });
  }

  // 4. Emit QUERY_HOOK_BFF_GAP for each hook referencing a gap endpoint
  for (const gap of hookGaps) {
    observations.push({
      kind: 'QUERY_HOOK_BFF_GAP',
      file: gap.hookFile,
      line: 1,
      evidence: {
        queryHookName: gap.hookName,
        fetchApiUrl: gap.fetchApiUrl,
        responseSchema: gap.responseSchema ?? undefined,
      },
    });
  }

  return {
    bffRoutes: bffRoutes.map(b => ({ path: b.relativePath, isStub: b.isStub })),
    mockRoutes: mockRoutes.map(m => ({ path: m.relativePath, apiPath: m.apiPath })),
    observations,
  };
}

// ---------------------------------------------------------------------------
// Observation extraction (for unified observation pipeline)
// ---------------------------------------------------------------------------

export function extractBffGapObservations(analysis: BffGapAnalysis): ObservationResult<BffGapObservation> {
  return {
    filePath: 'src/pages/api/',
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv, {
    namedOptions: ['--hook-dir'],
  });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-bff-gaps.ts <path...> [--pretty] [--no-cache] [--kind <kind>] [--count] [--hook-dir <dir>]\n' +
        '\n' +
        'Analyze BFF endpoint gaps (stubs, missing routes, mock-only endpoints).\n' +
        '\n' +
        '  <path...>       One or more directories to scan (e.g., src/pages/api/)\n' +
        '  --pretty        Format JSON output with indentation\n' +
        '  --no-cache      Bypass cache and recompute\n' +
        '  --kind          Filter observations to a specific kind\n' +
        '  --count         Output observation kind counts instead of full data\n' +
        '  --hook-dir      Directory containing query hooks for cross-referencing\n' +
        '\n' +
        'Observation kinds:\n' +
        '  BFF_STUB_ROUTE       BFF route returning 501\n' +
        '  MOCK_ROUTE           Mock route serving fixture data\n' +
        '  BFF_MISSING_ROUTE    Mock route with no corresponding BFF route\n' +
        '  QUERY_HOOK_BFF_GAP   Query hook referencing a gap endpoint\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');

  if (args.paths.length === 0) {
    fatal('No directory path provided. Use --help for usage.');
  }

  const hookDirs = args.options['hook-dir'] ? [args.options['hook-dir']] : [];

  let allObservations: BffGapObservation[] = [];
  let allBffRoutes: Array<{ path: string; isStub: boolean }> = [];
  let allMockRoutes: Array<{ path: string; apiPath: string }> = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);
    if (!stat.isDirectory()) {
      fatal(`Path must be a directory: ${targetPath}`);
    }

    const analysis = analyzeBffGaps(targetPath, { noCache, hookDirs });
    allBffRoutes = allBffRoutes.concat(analysis.bffRoutes);
    allMockRoutes = allMockRoutes.concat(analysis.mockRoutes);
    allObservations = allObservations.concat(analysis.observations);
  }

  const cacheStats = getCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    process.stderr.write(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses\n`);
  }

  const result: BffGapAnalysis = {
    bffRoutes: allBffRoutes,
    mockRoutes: allMockRoutes,
    observations: allObservations,
  };

  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-bff-gaps.ts') || process.argv[1].endsWith('ast-bff-gaps'));

if (isDirectRun) {
  main();
}
