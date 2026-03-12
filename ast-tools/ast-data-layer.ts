import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory, truncateText, getContainingFunctionName } from './shared';
import type { DataLayerAnalysis, DataLayerDetails, DataLayerUsage, DataLayerUsageType } from './types';

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
  if (/^use\w+Query$/.test(name)) return 'QUERY_HOOK_DEF';
  if (/^use\w+Mutation$/.test(name)) return 'MUTATION_HOOK_DEF';
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

function findQueryKeyDefinitions(sf: SourceFile): DataLayerUsage[] {
  const usages: DataLayerUsage[] = [];

  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!/(Keys|QueryKeys)$/.test(name)) continue;

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

      usages.push({
        type: 'QUERY_KEY_DEF',
        line,
        column,
        name,
        text: truncateText(decl.getText(), 80),
        containingFunction: '<module>',
        details: { keys: keyNames.join(', ') },
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

  // Also emit API_ENDPOINT if URL matches /api/ pattern
  if (url && /\/api\//.test(url)) {
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
    if (exprText === 'fetchApi' || exprText === 'useFetchApi') {
      if (exprText === 'fetchApi') {
        usages.push(...collectFetchApiUsages(node, line, column, containingFunction));
      }
      return;
    }

    // --- QUERY_INVALIDATION: queryClient.invalidateQueries(...) ---
    if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'invalidateQueries') {
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

export function analyzeDataLayerDirectory(dirPath: string): DataLayerAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute);

  const results: DataLayerAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = analyzeDataLayer(fp);
    if (analysis.usages.length > 0) {
      results.push(analysis);
    }
  }

  // Sort by total usages descending
  results.sort((a, b) => b.usages.length - a.usages.length);

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-data-layer.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze data layer patterns (query/mutation hooks, query keys, fetchApi, endpoints).\n' +
        '\n' +
        '  <path...>  One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty   Format JSON output with indentation\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const targetPath = args.paths[0];
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  if (!fs.existsSync(absolute)) {
    fatal(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(absolute);

  if (stat.isDirectory()) {
    const results = analyzeDataLayerDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeDataLayer(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-data-layer.ts') || process.argv[1].endsWith('ast-data-layer'));

if (isDirectRun) {
  main();
}
