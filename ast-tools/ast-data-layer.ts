import { type SourceFile, type ObjectLiteralExpression, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName, resolveTemplateLiteral, type FileFilter } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import type {
  DataLayerAnalysis,
  DataLayerDetails,
  DataLayerUsage,
  DataLayerUsageType,
  DataLayerObservation,
  DataLayerObservationKind,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): Record<DataLayerUsageType, number> {
  return {
    QUERY_HOOK_DEF: 0,
    MUTATION_HOOK_DEF: 0,
    QUERY_KEY_DEF: 0,
    FETCH_API_CALL: 0,
    API_ENDPOINT: 0,
    QUERY_INVALIDATION: 0,
  };
}

// ---------------------------------------------------------------------------
// Query key extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the queryKey value from a useQuery/useMutation options object.
 * Looks for `queryKey: [...]` inside the first object literal argument.
 */
function extractQueryKeyFromCallArgs(callNode: Node): string | null {
  if (!Node.isCallExpression(callNode)) return null;
  const args = callNode.getArguments();
  if (args.length === 0) return null;

  const firstArg = args[0];
  if (!Node.isObjectLiteralExpression(firstArg)) return null;

  const queryKeyProp = firstArg.getProperty('queryKey');
  if (!queryKeyProp) return null;

  if (Node.isPropertyAssignment(queryKeyProp)) {
    const init = queryKeyProp.getInitializer();
    if (init) return truncateText(init.getText(), 120);
  }

  return null;
}

/**
 * Extract the URL from a fetchApi call. Handles both positional and object args.
 * fetchApi<T>(url, config) -- url is first arg.
 */
function extractFetchApiUrl(callNode: Node): string | null {
  if (!Node.isCallExpression(callNode)) return null;
  const args = callNode.getArguments();
  if (args.length === 0) return null;

  const firstArg = args[0];
  // String literal: '/api/users/user-data'
  if (Node.isStringLiteral(firstArg)) {
    return firstArg.getLiteralText();
  }
  // Template literal: `/api/teams/${id}`
  if (Node.isTemplateExpression(firstArg) || Node.isNoSubstitutionTemplateLiteral(firstArg)) {
    return truncateText(firstArg.getText(), 120);
  }
  // Identifier or call expression (e.g., buildUrlWithParams(...))
  return truncateText(firstArg.getText(), 120);
}

/**
 * Extract the schema name from a fetchApi config object (second arg).
 */
function extractFetchApiSchema(callNode: Node): string | null {
  if (!Node.isCallExpression(callNode)) return null;
  const args = callNode.getArguments();
  if (args.length < 2) return null;

  const configArg = args[1];
  if (!Node.isObjectLiteralExpression(configArg)) return null;

  const schemaProp = configArg.getProperty('schema');
  if (!schemaProp) return null;

  if (Node.isPropertyAssignment(schemaProp)) {
    const init = schemaProp.getInitializer();
    if (init) return truncateText(init.getText(), 80);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Detection: query/mutation hook definitions
// ---------------------------------------------------------------------------

function classifyHookName(name: string): 'QUERY_HOOK_DEF' | 'MUTATION_HOOK_DEF' | null {
  const querySuffix = astConfig.dataLayer.queryHookSuffix;
  const mutationSuffix = astConfig.dataLayer.mutationHookSuffix;
  if (name.startsWith('use') && name.endsWith(querySuffix) && name.length > 3 + querySuffix.length) {
    return 'QUERY_HOOK_DEF';
  }
  if (name.startsWith('use') && name.endsWith(mutationSuffix) && name.length > 3 + mutationSuffix.length) {
    return 'MUTATION_HOOK_DEF';
  }
  return null;
}

function extractQueryKeyFromBody(body: Node): string | null {
  let queryKey: string | null = null;
  body.forEachDescendant(child => {
    if (queryKey) return;
    if (Node.isCallExpression(child)) {
      const callee = child.getExpression().getText();
      if (callee === 'useQuery') {
        queryKey = extractQueryKeyFromCallArgs(child);
      }
    }
  });
  return queryKey;
}

function buildHookDefUsage(
  type: 'QUERY_HOOK_DEF' | 'MUTATION_HOOK_DEF',
  line: number,
  column: number,
  name: string,
  textPrefix: string,
  body: Node | null,
): DataLayerUsage {
  const details: DataLayerDetails = {};
  if (type === 'QUERY_HOOK_DEF' && body) {
    const queryKey = extractQueryKeyFromBody(body);
    if (queryKey) details.queryKey = queryKey;
  }
  return {
    type,
    line,
    column,
    name,
    text: truncateText(`${textPrefix}${name}(...)`, 80),
    containingFunction: '<module>',
    details,
  };
}

function isFunctionLikeInit(node: Node): boolean {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function findHookDefinitions(sf: SourceFile): DataLayerUsage[] {
  const usages: DataLayerUsage[] = [];

  // Function declarations: export function useXxxQuery(...)
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (!name) continue;
    const type = classifyHookName(name);
    if (!type) continue;

    const line = func.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(func.getStart()).column;
    usages.push(buildHookDefUsage(type, line, column, name, 'function ', func));
  }

  // Variable declarations: const useXxxQuery = (...) => ...
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      const init = decl.getInitializer();
      if (!init) continue;
      if (!isFunctionLikeInit(init)) continue;

      const type = classifyHookName(name);
      if (!type) continue;

      const line = varStmt.getStartLineNumber();
      const column = sf.getLineAndColumnAtPos(varStmt.getStart()).column;
      usages.push(buildHookDefUsage(type, line, column, name, 'const ', init));
    }
  }

  return usages;
}

// ---------------------------------------------------------------------------
// Detection: query key factory definitions
// ---------------------------------------------------------------------------

/**
 * Build a map of module-level const string bindings for template resolution.
 * Only includes simple string literals and `'value' as const` patterns.
 */
function buildModuleBindings(sf: SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      let init = decl.getInitializer();
      if (!init) continue;

      // Unwrap `'value' as const`
      if (Node.isAsExpression(init)) {
        init = init.getExpression();
      }

      if (Node.isStringLiteral(init)) {
        bindings.set(decl.getName(), init.getLiteralText());
      }
    }
  }
  return bindings;
}

/**
 * Scan a query key factory's property values for template literals.
 * Returns a map from property name to resolved template string, only for
 * properties whose values contain at least one TemplateExpression.
 */
function resolveTemplateKeysInFactory(
  objLiteral: ObjectLiteralExpression,
  bindings: Map<string, string>,
): Record<string, string> | undefined {
  const resolved: Record<string, string> = {};
  let found = false;

  for (const prop of objLiteral.getProperties()) {
    if (!Node.isPropertyAssignment(prop) && !Node.isMethodDeclaration(prop)) continue;
    const propName = prop.getName();

    // Walk descendants looking for TemplateExpression nodes
    prop.forEachDescendant(child => {
      if (!Node.isTemplateExpression(child)) return;
      const resolvedText = resolveTemplateLiteral(child, bindings);
      resolved[propName] = resolvedText;
      found = true;
    });
  }

  return found ? resolved : undefined;
}

function findQueryKeyDefinitions(sf: SourceFile): DataLayerUsage[] {
  const usages: DataLayerUsage[] = [];
  const keyFactorySuffix = astConfig.dataLayer.queryKeyFactorySuffix;
  const bindings = buildModuleBindings(sf);

  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!name.endsWith(keyFactorySuffix)) continue;

      let init = decl.getInitializer();
      if (!init) continue;

      // Unwrap `{ ... } as const` -- the AsExpression wraps the object literal
      if (Node.isAsExpression(init)) {
        init = init.getExpression();
      }

      // Must be an object literal (key factory pattern)
      if (!Node.isObjectLiteralExpression(init)) continue;

      const line = varStmt.getStartLineNumber();
      const column = sf.getLineAndColumnAtPos(varStmt.getStart()).column;

      // Collect key names from the object
      const keyNames: string[] = [];
      for (const prop of init.getProperties()) {
        if (Node.isPropertyAssignment(prop) || Node.isMethodDeclaration(prop)) {
          keyNames.push(prop.getName());
        }
      }

      // Resolve template literals in factory property values
      const resolvedKeys = resolveTemplateKeysInFactory(init, bindings);

      const details: DataLayerDetails = { keys: keyNames.join(', ') };
      if (resolvedKeys) {
        details.resolvedKeys = resolvedKeys;
      }

      usages.push({
        type: 'QUERY_KEY_DEF',
        line,
        column,
        name,
        text: truncateText(decl.getText(), 80),
        containingFunction: '<module>',
        details,
      });
    }
  }

  return usages;
}

// ---------------------------------------------------------------------------
// Detection: fetchApi calls, API endpoints, query invalidations
// ---------------------------------------------------------------------------

function collectFetchApiUsages(node: Node, line: number, column: number, containingFunction: string): DataLayerUsage[] {
  const url = extractFetchApiUrl(node);
  const schema = extractFetchApiSchema(node);
  const details: DataLayerDetails = {};
  if (url) details.url = url;
  if (schema) details.schema = schema;

  const results: DataLayerUsage[] = [
    {
      type: 'FETCH_API_CALL',
      line,
      column,
      name: url ?? 'fetchApi',
      text: truncateText(node.getText(), 80),
      containingFunction,
      details,
    },
  ];

  // Also emit API_ENDPOINT if URL matches the API path marker
  const apiPathMarker = astConfig.dataLayer.apiPathMarker;
  if (url?.includes(apiPathMarker)) {
    results.push({
      type: 'API_ENDPOINT',
      line,
      column,
      name: url,
      text: url,
      containingFunction,
      details: schema ? { schema } : {},
    });
  }

  return results;
}

function extractInvalidationKeyText(node: Node): string {
  if (!Node.isCallExpression(node)) return '';
  const args = node.getArguments();
  if (args.length === 0) return '';

  const firstArg = args[0];
  if (Node.isObjectLiteralExpression(firstArg)) {
    const queryKeyProp = firstArg.getProperty('queryKey');
    if (queryKeyProp && Node.isPropertyAssignment(queryKeyProp)) {
      const init = queryKeyProp.getInitializer();
      if (init) return truncateText(init.getText(), 120);
    }
    return '';
  }
  return truncateText(firstArg.getText(), 120);
}

function findCallSiteUsages(sf: SourceFile): DataLayerUsage[] {
  const usages: DataLayerUsage[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    const exprText = expr.getText();
    const line = node.getStartLineNumber();
    const column = sf.getLineAndColumnAtPos(node.getStart()).column;
    const containingFunction = getContainingFunctionName(node);

    // --- FETCH_API_CALL: fetchApi(...) or useFetchApi() ---
    const fetchApiIdentifiers = astConfig.dataLayer.fetchApiIdentifiers;
    if (fetchApiIdentifiers.has(exprText)) {
      if (exprText === 'fetchApi') {
        usages.push(...collectFetchApiUsages(node, line, column, containingFunction));
      }
      return;
    }

    // --- QUERY_INVALIDATION: queryClient.invalidateQueries(...) ---
    const invalidateMethod = astConfig.dataLayer.invalidateMethod;
    if (Node.isPropertyAccessExpression(expr) && expr.getName() === invalidateMethod) {
      const keyText = extractInvalidationKeyText(node);
      usages.push({
        type: 'QUERY_INVALIDATION',
        line,
        column,
        name: keyText || 'invalidateQueries',
        text: truncateText(node.getText(), 80),
        containingFunction,
        details: keyText ? { queryKey: keyText } : {},
      });
    }
  });

  return usages;
}

// ---------------------------------------------------------------------------
// Summary computation
// ---------------------------------------------------------------------------

function computeSummary(usages: DataLayerUsage[]): Record<DataLayerUsageType, number> {
  const summary = emptySummary();
  for (const u of usages) {
    summary[u.type]++;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeDataLayer(filePath: string): DataLayerAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const usages = [...findHookDefinitions(sf), ...findQueryKeyDefinitions(sf), ...findCallSiteUsages(sf)];

  // Sort by line number
  usages.sort((a, b) => a.line - b.line || a.column - b.column);

  const summary = computeSummary(usages);

  return {
    filePath: relativePath,
    usages,
    summary,
  };
}

export function analyzeDataLayerDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): DataLayerAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: DataLayerAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-data-layer', fp, () => analyzeDataLayer(fp), options);
    if (analysis.usages.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by total usages descending
  results.sort((a, b) => b.usages.length - a.usages.length);

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

const USAGE_TYPE_TO_OBSERVATION_KIND: Record<DataLayerUsageType, DataLayerObservationKind> = {
  QUERY_HOOK_DEF: 'QUERY_HOOK_DEFINITION',
  MUTATION_HOOK_DEF: 'MUTATION_HOOK_DEFINITION',
  QUERY_KEY_DEF: 'QUERY_KEY_FACTORY',
  FETCH_API_CALL: 'FETCH_API_CALL',
  API_ENDPOINT: 'API_ENDPOINT',
  QUERY_INVALIDATION: 'QUERY_INVALIDATION',
};

/**
 * Extract data layer observations from analysis results.
 */
export function extractDataLayerObservations(analysis: DataLayerAnalysis): ObservationResult<DataLayerObservation> {
  const observations: DataLayerObservation[] = analysis.usages.map(usage => {
    const evidence: DataLayerObservation['evidence'] = {
      name: usage.name,
      containingFunction: usage.containingFunction,
    };

    if (usage.details.queryKey) {
      evidence.queryKey = [usage.details.queryKey];
    }
    if (usage.details.url) {
      evidence.url = usage.details.url;
    }
    if (usage.details.schema) {
      evidence.schema = usage.details.schema;
    }
    if (usage.details.keys) {
      evidence.keys = usage.details.keys.split(', ');
    }
    if (usage.details.resolvedKeys) {
      evidence.resolvedKeys = usage.details.resolvedKeys;
    }

    return {
      kind: USAGE_TYPE_TO_OBSERVATION_KIND[usage.type],
      file: analysis.filePath,
      line: usage.line,
      column: usage.column,
      evidence,
    };
  });

  return {
    filePath: analysis.filePath,
    observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-data-layer.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '\n' +
        'Analyze data layer patterns (query/mutation hooks, query keys, fetchApi, endpoints).\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: DataLayerAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeDataLayerDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }));
    } else {
      const result = cached('ast-data-layer', absolute, () => analyzeDataLayer(targetPath), { noCache });
      allResults.push(result);
    }
  }

  const cacheStats = getCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    process.stderr.write(`Cache: ${cacheStats.hits} hits, ${cacheStats.misses} misses\n`);
  }

  const result = allResults.length === 1 ? allResults[0] : allResults;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-data-layer.ts') || process.argv[1].endsWith('ast-data-layer'));

if (isDirectRun) {
  main();
}
