import { type SourceFile, type ExportedDeclarations, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, findConsumerFiles, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { DependencyGraph, FileNode, ImportInfo, ExportInfo } from './types';

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function extractImports(sf: SourceFile): ImportInfo[] {
  const merged = new Map<string, ImportInfo>();

  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    const line = decl.getStartLineNumber();
    const isTypeOnly = decl.isTypeOnly();
    const specifiers: string[] = [];

    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      specifiers.push(defaultImport.getText());
    }

    const namespaceImport = decl.getNamespaceImport();
    if (namespaceImport) {
      specifiers.push(`* as ${namespaceImport.getText()}`);
    }

    for (const named of decl.getNamedImports()) {
      const alias = named.getAliasNode();
      if (alias) {
        specifiers.push(`${named.getName()} as ${alias.getText()}`);
      } else {
        specifiers.push(named.getName());
      }
    }

    const existing = merged.get(source);
    if (existing) {
      for (const s of specifiers) {
        if (!existing.specifiers.includes(s)) {
          existing.specifiers.push(s);
        }
      }
      existing.isTypeOnly = existing.isTypeOnly && isTypeOnly;
    } else {
      merged.set(source, { source, specifiers, isTypeOnly, line });
    }
  }

  return Array.from(merged.values());
}

// ---------------------------------------------------------------------------
// Dynamic import extraction
// ---------------------------------------------------------------------------

function extractDynamicImports(sf: SourceFile): ImportInfo[] {
  const results: ImportInfo[] = [];

  sf.forEachDescendant(node => {
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (expr.getKind() === SyntaxKind.ImportKeyword) {
        const args = node.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          const source = args[0].getLiteralValue();
          results.push({
            source,
            specifiers: ['*'],
            isTypeOnly: false,
            line: node.getStartLineNumber(),
          });
        }
      }
    }
  });

  return results;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

function classifyExportKind(name: string, declarations: ExportedDeclarations[]): ExportInfo['kind'] {
  if (declarations.length === 0) return 'const';
  const decl = declarations[0];

  if (Node.isFunctionDeclaration(decl)) return 'function';
  if (Node.isClassDeclaration(decl)) return 'class';
  if (Node.isTypeAliasDeclaration(decl)) return 'type';
  if (Node.isInterfaceDeclaration(decl)) return 'interface';
  if (Node.isEnumDeclaration(decl)) return 'enum';

  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return 'function';
    }
    return 'const';
  }

  if (name === 'default') return 'default';
  return 'const';
}

function extractExports(sf: SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const exportedMap = sf.getExportedDeclarations();

  for (const [name, declarations] of exportedMap) {
    const kind = classifyExportKind(name, declarations);
    const isTypeOnly = kind === 'type' || kind === 'interface';

    const firstDecl = declarations[0];
    const line = firstDecl ? firstDecl.getStartLineNumber() : 1;

    exports.push({ name, kind, isTypeOnly, line });
  }

  // Detect re-exports from export declarations
  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    if (exportDecl.isNamespaceExport()) {
      // export * from './foo'
      exports.push({
        name: `* from ${moduleSpecifier}`,
        kind: 'reexport',
        isTypeOnly: exportDecl.isTypeOnly(),
        line: exportDecl.getStartLineNumber(),
      });
    } else {
      for (const named of exportDecl.getNamedExports()) {
        const exportName = named.getAliasNode()?.getText() ?? named.getName();
        // Only add if not already tracked by getExportedDeclarations
        const alreadyTracked = exports.some(e => e.name === exportName && e.kind !== 'reexport');
        if (!alreadyTracked) {
          exports.push({
            name: exportName,
            kind: 'reexport',
            isTypeOnly: exportDecl.isTypeOnly(),
            line: exportDecl.getStartLineNumber(),
          });
        }
      }
    }
  }

  // Mark re-exported names: if the source file has an export declaration
  // with a module specifier for a named export, override its kind to reexport
  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;
    if (exportDecl.isNamespaceExport()) continue;

    for (const named of exportDecl.getNamedExports()) {
      const exportName = named.getAliasNode()?.getText() ?? named.getName();
      const existing = exports.find(e => e.name === exportName && e.kind !== 'reexport');
      if (existing) {
        existing.kind = 'reexport';
      }
    }
  }

  return exports;
}

// ---------------------------------------------------------------------------
// Import re-exports (treat as both import and export)
// ---------------------------------------------------------------------------

function extractReexportImports(sf: SourceFile): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    const specifiers: string[] = [];

    if (exportDecl.isNamespaceExport()) {
      specifiers.push('*');
    } else {
      for (const named of exportDecl.getNamedExports()) {
        specifiers.push(named.getName());
      }
    }

    imports.push({
      source: moduleSpecifier,
      specifiers,
      isTypeOnly: exportDecl.isTypeOnly(),
      line: exportDecl.getStartLineNumber(),
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Module resolution
// ---------------------------------------------------------------------------

function resolveModulePath(importSource: string, importingFilePath: string): string | null {
  // Package imports -- return as-is
  if (!importSource.startsWith('.') && !importSource.startsWith('@/')) {
    return null;
  }

  // Use ts-morph's built-in resolution for both relative and alias imports
  const project = getProject();
  const sf = project.getSourceFile(importingFilePath);
  if (!sf) return null;

  // Find the matching import declaration
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }

  // Check export declarations (re-exports)
  for (const decl of sf.getExportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }

  // Manual fallback for relative imports
  if (importSource.startsWith('.')) {
    const dir = path.dirname(importingFilePath);
    const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const candidate = path.resolve(dir, importSource + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
    // Try exact path (already has extension)
    const exact = path.resolve(dir, importSource);
    if (fs.existsSync(exact)) return exact;
  }

  return null;
}

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------

function analyzeFile(filePath: string): FileNode {
  const sf = getSourceFile(filePath);
  const absPath = sf.getFilePath();
  const relativePath = path.relative(PROJECT_ROOT, absPath);

  const regularImports = extractImports(sf);
  const dynamicImports = extractDynamicImports(sf);
  const reexportImports = extractReexportImports(sf);

  // Merge re-export imports into regular imports
  const allImports = [...regularImports];
  for (const ri of [...dynamicImports, ...reexportImports]) {
    const existing = allImports.find(i => i.source === ri.source);
    if (existing) {
      for (const s of ri.specifiers) {
        if (!existing.specifiers.includes(s)) {
          existing.specifiers.push(s);
        }
      }
    } else {
      allImports.push(ri);
    }
  }

  const exports = extractExports(sf);

  return {
    path: absPath,
    relativePath,
    imports: allImports,
    exports,
  };
}

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

function buildEdges(files: FileNode[]): Array<{ from: string; to: string; specifiers: string[] }> {
  const edges: Array<{ from: string; to: string; specifiers: string[] }> = [];

  for (const file of files) {
    for (const imp of file.imports) {
      const resolvedPath = resolveModulePath(imp.source, file.path);
      if (resolvedPath) {
        const to = path.relative(PROJECT_ROOT, resolvedPath);
        edges.push({
          from: file.relativePath,
          to,
          specifiers: imp.specifiers,
        });
      }
    }
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Circular dependency detection (DFS with coloring)
// ---------------------------------------------------------------------------

function detectCircularDeps(edges: Array<{ from: string; to: string; specifiers: string[] }>): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const existing = adjacency.get(edge.from);
    if (existing) {
      if (!existing.includes(edge.to)) {
        existing.push(edge.to);
      }
    } else {
      adjacency.set(edge.from, [edge.to]);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const pathStack: string[] = [];

  function dfs(node: string): void {
    color.set(node, GRAY);
    pathStack.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      const neighborColor = color.get(neighbor) ?? WHITE;

      if (neighborColor === GRAY) {
        // Found a cycle -- extract the cycle from pathStack
        const cycleStart = pathStack.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = pathStack.slice(cycleStart);
          cycle.push(neighbor); // close the loop
          cycles.push(cycle);
        }
      } else if (neighborColor === WHITE) {
        dfs(neighbor);
      }
    }

    pathStack.pop();
    color.set(node, BLACK);
  }

  for (const node of adjacency.keys()) {
    if ((color.get(node) ?? WHITE) === WHITE) {
      dfs(node);
    }
  }

  return cycles;
}

// ---------------------------------------------------------------------------
// Barrel chain resolution
// ---------------------------------------------------------------------------

function isBarrelFile(filePath: string): boolean {
  return path.basename(filePath).startsWith('index.');
}

/**
 * Given an export name and a file path, trace through barrel re-export
 * chains to find the original source file.
 */
function traceBarrelChain(exportName: string, filePath: string, visited = new Set<string>()): string[] {
  if (visited.has(filePath)) return [];
  visited.add(filePath);

  const chain: string[] = [filePath];

  try {
    const sf = getSourceFile(filePath);

    for (const exportDecl of sf.getExportDeclarations()) {
      const moduleSpecifier = exportDecl.getModuleSpecifierValue();
      if (!moduleSpecifier) continue;

      let matches = false;

      if (exportDecl.isNamespaceExport()) {
        // export * -- could include anything
        matches = true;
      } else {
        for (const named of exportDecl.getNamedExports()) {
          const name = named.getAliasNode()?.getText() ?? named.getName();
          if (name === exportName) {
            matches = true;
            break;
          }
        }
      }

      if (matches) {
        const resolved = exportDecl.getModuleSpecifierSourceFile();
        if (resolved) {
          const resolvedPath = resolved.getFilePath();
          const deeper = traceBarrelChain(exportName, resolvedPath, visited);
          chain.push(...deeper);
        }
      }
    }
  } catch (error) {
    console.error(
      `[ast-imports] traceBarrelChain: could not load barrel file ${filePath}: ${error instanceof Error ? error.message : error}`,
    );
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Dead export detection
// ---------------------------------------------------------------------------

function isNextJsPage(filePath: string): boolean {
  const rel = path.relative(PROJECT_ROOT, filePath);
  return rel.startsWith('src/pages/') || rel.startsWith('src/pages\\');
}

function detectDeadExports(
  files: FileNode[],
  allEdges: Array<{ from: string; to: string; specifiers: string[] }>,
  fixtureSearchDir?: string,
): Array<{ file: string; export: string; line: number }> {
  const dead: Array<{ file: string; export: string; line: number }> = [];
  // Cache consumer candidates per file path to avoid repeated ripgrep calls
  const consumerCache = new Map<string, string[]>();

  for (const file of files) {
    // Skip Next.js page files -- their default exports are consumed by the framework
    if (isNextJsPage(file.path)) continue;

    for (const exp of file.exports) {
      // Skip re-exports (they are pass-through, not dead)
      if (exp.kind === 'reexport') continue;
      // Skip star re-export entries
      if (exp.name.startsWith('* from ')) continue;

      // Check if any edge in the graph imports this name from this file
      const isConsumedByEdge = allEdges.some(
        e =>
          e.to === file.relativePath &&
          (e.specifiers.includes(exp.name) || e.specifiers.includes('*') || e.specifiers.includes(`* as ${exp.name}`)),
      );

      if (isConsumedByEdge) continue;

      // Check barrel re-exports: if this export is re-exported by a barrel, it is alive
      let consumerCandidates = consumerCache.get(file.path);
      if (!consumerCandidates) {
        consumerCandidates = fixtureSearchDir
          ? findConsumerFiles(file.path, fixtureSearchDir)
          : findConsumerFiles(file.path);
        consumerCache.set(file.path, consumerCandidates);
      }

      const isReexported = consumerCandidates.some(consumer => {
        if (!isBarrelFile(consumer)) return false;
        try {
          const consumerSf = getSourceFile(consumer);
          for (const exportDecl of consumerSf.getExportDeclarations()) {
            if (exportDecl.isNamespaceExport() && exportDecl.getModuleSpecifierValue()) {
              return true;
            }
            for (const named of exportDecl.getNamedExports()) {
              if (named.getName() === exp.name) return true;
            }
          }
        } catch (error) {
          console.error(
            `[ast-imports] detectDeadExports: could not check re-exports in ${consumer}: ${error instanceof Error ? error.message : error}`,
          );
        }
        return false;
      });

      if (isReexported) continue;

      // Check if any file outside the graph actually imports this name
      const isConsumedExternally = consumerCandidates.some(consumer => {
        try {
          const consumerSf = getSourceFile(consumer);
          for (const imp of consumerSf.getImportDeclarations()) {
            const resolvedSf = imp.getModuleSpecifierSourceFile();
            if (!resolvedSf) continue;
            if (resolvedSf.getFilePath() !== file.path) continue;

            // Check named imports
            for (const named of imp.getNamedImports()) {
              if (named.getName() === exp.name) return true;
            }
            // Check default import
            if (exp.name === 'default' && imp.getDefaultImport()) return true;
            // Check namespace import
            if (imp.getNamespaceImport()) return true;
          }
        } catch (error) {
          console.error(
            `[ast-imports] detectDeadExports: could not check external consumers of ${consumer}: ${error instanceof Error ? error.message : error}`,
          );
        }
        return false;
      });

      if (isConsumedExternally) continue;

      dead.push({
        file: file.relativePath,
        export: exp.name,
        line: exp.line,
      });
    }
  }

  return dead;
}

// ---------------------------------------------------------------------------
// Consumer detection (for single-file mode)
// ---------------------------------------------------------------------------

function findConsumersForFile(targetFile: FileNode, searchDir?: string): FileNode[] {
  const consumers: FileNode[] = [];
  const candidatePaths = searchDir ? findConsumerFiles(targetFile.path, searchDir) : findConsumerFiles(targetFile.path);

  for (const candidatePath of candidatePaths) {
    try {
      const candidateSf = getSourceFile(candidatePath);

      // Check if any import resolves to the target file
      let isConsumer = false;
      for (const imp of candidateSf.getImportDeclarations()) {
        const resolved = imp.getModuleSpecifierSourceFile();
        if (resolved && resolved.getFilePath() === targetFile.path) {
          isConsumer = true;
          break;
        }
      }

      // Also check export declarations (re-exports)
      if (!isConsumer) {
        for (const exp of candidateSf.getExportDeclarations()) {
          const resolved = exp.getModuleSpecifierSourceFile();
          if (resolved && resolved.getFilePath() === targetFile.path) {
            isConsumer = true;
            break;
          }
        }
      }

      if (isConsumer) {
        consumers.push(analyzeFile(candidatePath));
      }
    } catch (error) {
      console.error(
        `[ast-imports] findConsumersForFile: could not load ${candidatePath}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return consumers;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildDependencyGraph(targetPath: string, options?: { searchDir?: string }): DependencyGraph {
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  const stat = fs.statSync(absolute);
  const isDirectory = stat.isDirectory();
  const searchDir = options?.searchDir;

  let files: FileNode[];

  if (isDirectory) {
    const filePaths = getFilesInDirectory(absolute);
    files = filePaths.map(fp => analyzeFile(fp));

    // Add consumer files from outside the directory
    const allConsumers: FileNode[] = [];
    const filePathSet = new Set(files.map(f => f.path));

    for (const file of files) {
      const consumers = findConsumersForFile(file, searchDir);
      for (const consumer of consumers) {
        if (!filePathSet.has(consumer.path)) {
          allConsumers.push(consumer);
          filePathSet.add(consumer.path);
        }
      }
    }

    files.push(...allConsumers);
  } else {
    const targetFile = analyzeFile(absolute);
    files = [targetFile];

    // Add consumer files
    const consumers = findConsumersForFile(targetFile, searchDir);
    const filePathSet = new Set([targetFile.path]);

    for (const consumer of consumers) {
      if (!filePathSet.has(consumer.path)) {
        files.push(consumer);
        filePathSet.add(consumer.path);
      }
    }
  }

  const edges = buildEdges(files);
  const circularDeps = detectCircularDeps(edges);
  const deadExports = detectDeadExports(
    isDirectory ? files.filter(f => f.path.startsWith(absolute)) : [files[0]],
    edges,
    searchDir,
  );

  return { files, edges, circularDeps, deadExports };
}

// ---------------------------------------------------------------------------
// Barrel chain analysis (exported for other tools)
// ---------------------------------------------------------------------------

export { traceBarrelChain, isBarrelFile };

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-imports.ts <path> [--pretty]\n' +
        '\n' +
        'Analyze imports, exports, and dependency relationships.\n' +
        '\n' +
        '  <path>     File or directory to analyze\n' +
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

  const graph = buildDependencyGraph(targetPath);
  output(graph, args.pretty);
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-imports.ts') || process.argv[1].endsWith('ast-imports'));

if (isDirectRun) {
  main();
}
