/**
 * AST tool: Branded Type Check
 *
 * Detects two classes of branded-type gaps:
 *
 * 1. UNBRANDED_ID_FIELD: Property signatures in interfaces/type aliases
 *    where a branded type should be used but a primitive base type is used
 *    instead. For example, `userId: string` should be `userId: UserId`.
 *
 * 2. UNBRANDED_PARAM: Function/method parameters and return types where
 *    a branded type should be used but a bare primitive is used instead.
 *    For example, `function getUser(userId: string)` should use `UserId`.
 *
 * The branded field patterns and exclusions are configured in `ast-config.ts`
 * under `brandedCheck`.
 *
 * Exclusions:
 *   - Schema files (*.schema.ts) -- define the Zod parse boundary
 *   - Test and fixture files
 *   - Wire-format types (names containing Response, Request, etc.)
 *   - Brand definition files
 *   - Parameter names in paramExcludeNames (generic names like 'name', 'label')
 */

import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, type FileFilter } from './shared';
import { resolveConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import type { BrandedCheckObservation, BrandedCheckAnalysis, ObservationResult } from './types';

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze a single file for unbranded ID field and parameter patterns.
 */
export function analyzeBrandedCheck(filePath: string): BrandedCheckAnalysis {
  const config = resolveConfig();
  const { fieldPatterns, excludePathPatterns, excludeTypeNamePatterns, paramExcludeNames } = config.brandedCheck;

  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  // Check path exclusions
  for (const pattern of excludePathPatterns) {
    if (relativePath.includes(pattern)) {
      return { filePath: relativePath, observations: [] };
    }
  }

  const sf = getSourceFile(absolute);
  const observations: BrandedCheckObservation[] = [];

  // --- Pass 1: Property signatures (UNBRANDED_ID_FIELD) ---
  sf.forEachDescendant(node => {
    if (!Node.isPropertySignature(node) && !Node.isPropertyDeclaration(node)) return;

    const propName = node.getName();
    const pattern = fieldPatterns[propName];
    if (!pattern) return;

    const typeNode = node.getTypeNode();
    if (!typeNode) return;

    const typeText = typeNode.getText().trim();
    if (typeText !== pattern.baseType) return;

    const containingType = findContainingTypeName(node);
    if (containingType) {
      for (const excludePattern of excludeTypeNamePatterns) {
        if (containingType.includes(excludePattern)) return;
      }
    }

    const line = node.getStartLineNumber();

    observations.push({
      kind: 'UNBRANDED_ID_FIELD',
      file: relativePath,
      line,
      evidence: {
        propertyName: propName,
        actualType: typeText,
        expectedType: pattern.brandedType,
        containingType: containingType ?? '<anonymous>',
      },
    });
  });

  // --- Pass 2: Function/method parameters and return types (UNBRANDED_PARAM) ---
  sf.forEachDescendant(node => {
    // Match function declarations, arrow functions, and method declarations
    const isFunctionLike =
      Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isMethodDeclaration(node);
    if (!isFunctionLike) return;

    const functionName = getFunctionName(node);

    // Check parameters
    const params = node.getParameters();
    for (const param of params) {
      const paramName = param.getName();

      // Skip allowlisted parameter names
      if (paramExcludeNames.has(paramName)) continue;

      const pattern = fieldPatterns[paramName];
      if (!pattern) continue;

      const typeNode = param.getTypeNode();
      if (!typeNode) continue;

      const typeText = typeNode.getText().trim();
      if (typeText !== pattern.baseType) continue;

      const line = param.getStartLineNumber();

      observations.push({
        kind: 'UNBRANDED_PARAM',
        file: relativePath,
        line,
        evidence: {
          functionName,
          parameterName: paramName,
          declaredType: pattern.baseType as 'string' | 'number',
          actualType: typeText,
          expectedType: pattern.brandedType,
          evidence: `parameter '${paramName}' in function '${functionName}' uses bare '${pattern.baseType}' where branded type '${pattern.brandedType}' is expected`,
        },
      });
    }

    // Check return type annotation
    const returnTypeNode = node.getReturnTypeNode();
    if (returnTypeNode) {
      const returnText = returnTypeNode.getText().trim();

      // Check if the return type is a bare primitive that matches a branded base type
      for (const [fieldName, pattern] of Object.entries(fieldPatterns)) {
        if (returnText === pattern.baseType) {
          // Only flag return types if the function name ends with the field pattern name
          // (case-insensitive). e.g., getUserId -> matches 'userId', getTeamId -> matches 'teamId'.
          // This avoids false positives like getUserName matching UserId.
          const lowerName = functionName.toLowerCase();
          const lowerField = fieldName.toLowerCase();
          if (lowerName.endsWith(lowerField)) {
            const line = returnTypeNode.getStartLineNumber();

            observations.push({
              kind: 'UNBRANDED_PARAM',
              file: relativePath,
              line,
              evidence: {
                functionName,
                parameterName: 'return',
                declaredType: pattern.baseType as 'string' | 'number',
                actualType: returnText,
                expectedType: pattern.brandedType,
                evidence: `function '${functionName}' returns bare '${pattern.baseType}' where branded type '${pattern.brandedType}' is expected`,
              },
            });
            break; // Only one return observation per function
          }
        }
      }
    }
  });

  return { filePath: relativePath, observations };
}

/**
 * Extract the name of a function-like node.
 */
function getFunctionName(node: Node): string {
  if (Node.isFunctionDeclaration(node)) {
    return node.getName() ?? '<anonymous>';
  }
  if (Node.isMethodDeclaration(node)) {
    return node.getName();
  }
  if (Node.isArrowFunction(node)) {
    // Try to get the variable declaration name
    const parent = node.getParent();
    if (parent && Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
    // Try property assignment
    if (parent && Node.isPropertyDeclaration(parent)) {
      return parent.getName();
    }
    return '<arrow>';
  }
  return '<unknown>';
}

/**
 * Find the name of the containing interface, type alias, or class.
 */
function findContainingTypeName(node: Node): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isInterfaceDeclaration(current)) return current.getName();
    if (Node.isTypeAliasDeclaration(current)) return current.getName();
    if (Node.isClassDeclaration(current)) return current.getName() ?? null;
    // Stop at function/module boundaries
    if (Node.isFunctionDeclaration(current) || Node.isSourceFile(current)) break;
    current = current.getParent();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Directory analysis
// ---------------------------------------------------------------------------

export function analyzeBrandedCheckDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): BrandedCheckAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const files = getFilesInDirectory(absolute, options.filter ?? 'production');
  const results: BrandedCheckAnalysis[] = [];

  for (const fp of files) {
    const analysis = cached('ast-branded-check', fp, () => analyzeBrandedCheck(fp), options);
    if (analysis.observations.length > 0) {
      results.push(analysis);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractBrandedCheckObservations(
  analysis: BrandedCheckAnalysis,
): ObservationResult<BrandedCheckObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-branded-check.ts <path...> [--pretty] [--no-cache] [--kind <kind>] [--count]\n' +
        '\n' +
        'Detect property signatures and function parameters using primitive types\n' +
        'where branded types should be used.\n' +
        '\n' +
        '  <path...>     One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n' +
        '\n' +
        'Observation kinds:\n' +
        '  UNBRANDED_ID_FIELD    Property uses primitive type where branded type is expected\n' +
        '  UNBRANDED_PARAM       Function parameter or return uses primitive where branded type is expected\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: BrandedCheckAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeBrandedCheckDirectory(targetPath, { noCache }));
    } else {
      const result = cached('ast-branded-check', absolute, () => analyzeBrandedCheck(targetPath), { noCache });
      if (result.observations.length > 0) {
        allResults.push(result);
      }
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
  process.argv[1] &&
  (process.argv[1].endsWith('ast-branded-check.ts') || process.argv[1].endsWith('ast-branded-check'));

if (isDirectRun) {
  main();
}
