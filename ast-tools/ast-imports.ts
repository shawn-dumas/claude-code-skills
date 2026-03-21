import { type SourceFile, type ExportedDeclarations, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, findConsumerFiles, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import type { FileFilter } from './shared';
import { astConfig } from './ast-config';
import type {
  DependencyGraph,
  FileNode,
  ImportInfo,
  ExportInfo,
  ImportObservation,
  ImportObservationKind,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/** Collect all specifier strings from a single import declaration. */
function collectImportSpecifiers(decl: ReturnType<SourceFile['getImportDeclarations']>[number]): string[] {
  const specifiers: string[] = [];

  const defaultImport = decl.getDefaultImport();
  if (defaultImport) specifiers.push(defaultImport.getText());

  const namespaceImport = decl.getNamespaceImport();
  if (namespaceImport) specifiers.push(`* as ${namespaceImport.getText()}`);

  for (const named of decl.getNamedImports()) {
    const alias = named.getAliasNode();
    specifiers.push(alias ? `${named.getName()} as ${alias.getText()}` : named.getName());
  }

  return specifiers;
}

/** Merge specifiers into an existing ImportInfo entry, or insert a new one. */
function mergeImportEntry(
  merged: Map<string, ImportInfo>,
  source: string,
  specifiers: string[],
  isTypeOnly: boolean,
  line: number,
): void {
  const existing = merged.get(source);
  if (existing) {
    for (const s of specifiers) {
      if (!existing.specifiers.includes(s)) existing.specifiers.push(s);
    }
    existing.isTypeOnly = existing.isTypeOnly && isTypeOnly;
  } else {
    merged.set(source, { source, specifiers, isTypeOnly, line });
  }
}

function extractImports(sf: SourceFile): ImportInfo[] {
  const merged = new Map<string, ImportInfo>();

  for (const decl of sf.getImportDeclarations()) {
    const specifiers = collectImportSpecifiers(decl);
    mergeImportEntry(merged, decl.getModuleSpecifierValue(), specifiers, decl.isTypeOnly(), decl.getStartLineNumber());
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

/** Maps a ts-morph Node guard to the ExportInfo kind it implies. */
const DECLARATION_KIND_CHECKS: Array<{
  guard: (node: Node) => boolean;
  kind: ExportInfo['kind'];
}> = [
  { guard: Node.isFunctionDeclaration, kind: 'function' },
  { guard: Node.isClassDeclaration, kind: 'class' },
  { guard: Node.isTypeAliasDeclaration, kind: 'type' },
  { guard: Node.isInterfaceDeclaration, kind: 'interface' },
  { guard: Node.isEnumDeclaration, kind: 'enum' },
];

/** If the declaration is a variable initialized to a function expression, return 'function'. */
function classifyVariableDeclaration(decl: Node): ExportInfo['kind'] {
  if (!Node.isVariableDeclaration(decl)) return 'const';
  const init = decl.getInitializer();
  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
    return 'function';
  }
  return 'const';
}

function classifyExportKind(name: string, declarations: ExportedDeclarations[]): ExportInfo['kind'] {
  if (declarations.length === 0) return 'const';
  const decl = declarations[0];

  const matched = DECLARATION_KIND_CHECKS.find(check => check.guard(decl));
  if (matched) return matched.kind;

  if (Node.isVariableDeclaration(decl)) return classifyVariableDeclaration(decl);

  if (name === 'default') return 'default';
  return 'const';
}

/** Collect exports from ts-morph's getExportedDeclarations map. */
function collectDeclaredExports(sf: SourceFile): ExportInfo[] {
  const exports: ExportInfo[] = [];
  for (const [name, declarations] of sf.getExportedDeclarations()) {
    const kind = classifyExportKind(name, declarations);
    const isTypeOnly = kind === 'type' || kind === 'interface';
    const firstDecl = declarations[0];
    const line = firstDecl ? firstDecl.getStartLineNumber() : 1;
    exports.push({ name, kind, isTypeOnly, line });
  }
  return exports;
}

/** Add re-export entries from `export { ... } from '...'` and `export * from '...'`. */
function collectReexportEntries(sf: SourceFile, exports: ExportInfo[]): void {
  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    if (exportDecl.isNamespaceExport()) {
      exports.push({
        name: `* from ${moduleSpecifier}`,
        kind: 'reexport',
        isTypeOnly: exportDecl.isTypeOnly(),
        line: exportDecl.getStartLineNumber(),
      });
    } else {
      for (const named of exportDecl.getNamedExports()) {
        const exportName = named.getAliasNode()?.getText() ?? named.getName();
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
}

/** Override kind to 'reexport' for named exports that are re-exported with a module specifier. */
function markReexportedNames(sf: SourceFile, exports: ExportInfo[]): void {
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
}

function extractExports(sf: SourceFile): ExportInfo[] {
  const exports = collectDeclaredExports(sf);
  collectReexportEntries(sf, exports);
  markReexportedNames(sf, exports);
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

/** Resolve via ts-morph import declarations. */
function resolveViaImportDeclarations(sf: SourceFile, importSource: string): string | null {
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }
  return null;
}

/** Resolve via ts-morph export declarations (re-exports). */
function resolveViaExportDeclarations(sf: SourceFile, importSource: string): string | null {
  for (const decl of sf.getExportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }
  return null;
}

/** Manual filesystem fallback for relative imports. */
function resolveRelativeFallback(importSource: string, importingFilePath: string): string | null {
  const dir = path.dirname(importingFilePath);
  const extensions = astConfig.fileDiscovery.moduleResolutionExtensions;
  for (const ext of extensions) {
    const candidate = path.resolve(dir, importSource + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  const exact = path.resolve(dir, importSource);
  if (fs.existsSync(exact)) return exact;
  return null;
}

function resolveModulePath(importSource: string, importingFilePath: string): string | null {
  const pathAliasPrefix = astConfig.fileDiscovery.pathAliasPrefix;
  if (!importSource.startsWith('.') && !importSource.startsWith(pathAliasPrefix)) {
    return null;
  }

  const project = getProject();
  const sf = project.getSourceFile(importingFilePath);
  if (!sf) return null;

  const fromImport = resolveViaImportDeclarations(sf, importSource);
  if (fromImport) return fromImport;

  const fromExport = resolveViaExportDeclarations(sf, importSource);
  if (fromExport) return fromExport;

  if (importSource.startsWith('.')) {
    return resolveRelativeFallback(importSource, importingFilePath);
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

/** Check if an export declaration re-exports the given name (namespace or named). */
function exportDeclMatchesName(
  exportDecl: ReturnType<SourceFile['getExportDeclarations']>[number],
  exportName: string,
): boolean {
  if (exportDecl.isNamespaceExport()) return true;
  for (const named of exportDecl.getNamedExports()) {
    const name = named.getAliasNode()?.getText() ?? named.getName();
    if (name === exportName) return true;
  }
  return false;
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
      if (!exportDeclMatchesName(exportDecl, exportName)) continue;

      const resolved = exportDecl.getModuleSpecifierSourceFile();
      if (resolved) {
        const deeper = traceBarrelChain(exportName, resolved.getFilePath(), visited);
        chain.push(...deeper);
      }
    }
  } catch (error) {
    process.stderr.write(
      `[ast-imports] traceBarrelChain: could not load barrel file ${filePath}: ${error instanceof Error ? error.message : error}\n`,
    );
  }

  return chain;
}

// ---------------------------------------------------------------------------
// Dead export detection
// ---------------------------------------------------------------------------

function isNextJsPage(filePath: string): boolean {
  const rel = path.relative(PROJECT_ROOT, filePath);
  const prefix = astConfig.imports.nextJsPagePrefix;
  return rel.startsWith(prefix) || rel.startsWith(prefix.replace(/\//g, '\\'));
}

// ---------------------------------------------------------------------------
// Dead export detection helpers
// ---------------------------------------------------------------------------

/** Check if any edge in the graph imports this export name from this file. */
function isConsumedByEdge(
  exportName: string,
  fileRelativePath: string,
  allEdges: Array<{ from: string; to: string; specifiers: string[] }>,
): boolean {
  return allEdges.some(
    e =>
      e.to === fileRelativePath &&
      (e.specifiers.includes(exportName) || e.specifiers.includes('*') || e.specifiers.includes(`* as ${exportName}`)),
  );
}

/** Check if any barrel file re-exports this name. */
function isReexportedByBarrel(exportName: string, consumerCandidates: string[]): boolean {
  return consumerCandidates.some(consumer => {
    if (!isBarrelFile(consumer)) return false;
    try {
      const consumerSf = getSourceFile(consumer);
      for (const exportDecl of consumerSf.getExportDeclarations()) {
        if (exportDecl.isNamespaceExport() && exportDecl.getModuleSpecifierValue()) {
          return true;
        }
        for (const named of exportDecl.getNamedExports()) {
          if (named.getName() === exportName) return true;
        }
      }
    } catch (error) {
      process.stderr.write(
        `[ast-imports] isReexportedByBarrel: could not check re-exports in ${consumer}: ${error instanceof Error ? error.message : error}\n`,
      );
    }
    return false;
  });
}

/** Check if a single consumer file imports the given export name from filePath. */
function consumerImportsName(consumer: string, exportName: string, filePath: string): boolean {
  const consumerSf = getSourceFile(consumer);
  for (const imp of consumerSf.getImportDeclarations()) {
    const resolvedSf = imp.getModuleSpecifierSourceFile();
    if (!resolvedSf) continue;
    if (resolvedSf.getFilePath() !== filePath) continue;

    for (const named of imp.getNamedImports()) {
      if (named.getName() === exportName) return true;
    }
    if (exportName === 'default' && imp.getDefaultImport()) return true;
    if (imp.getNamespaceImport()) return true;
  }
  return false;
}

/** Check if any file outside the graph directly imports this name. */
function isConsumedExternally(exportName: string, filePath: string, consumerCandidates: string[]): boolean {
  return consumerCandidates.some(consumer => {
    try {
      return consumerImportsName(consumer, exportName, filePath);
    } catch (error) {
      process.stderr.write(
        `[ast-imports] isConsumedExternally: could not check external consumers of ${consumer}: ${error instanceof Error ? error.message : error}\n`,
      );
    }
    return false;
  });
}

function detectDeadExports(
  files: FileNode[],
  allEdges: Array<{ from: string; to: string; specifiers: string[] }>,
  fixtureSearchDir?: string,
): Array<{ file: string; export: string; line: number }> {
  const dead: Array<{ file: string; export: string; line: number }> = [];
  // Cache consumer candidates per file path to avoid repeated ripgrep calls
  const consumerCache = new Map<string, string[]>();

  function getConsumerCandidates(filePath: string): string[] {
    let candidates = consumerCache.get(filePath);
    if (!candidates) {
      candidates = fixtureSearchDir ? findConsumerFiles(filePath, fixtureSearchDir) : findConsumerFiles(filePath);
      consumerCache.set(filePath, candidates);
    }
    return candidates;
  }

  for (const file of files) {
    // Skip Next.js page files -- their default exports are consumed by the framework
    if (isNextJsPage(file.path)) continue;

    for (const exp of file.exports) {
      // Skip re-exports (they are pass-through, not dead)
      if (exp.kind === 'reexport') continue;
      // Skip star re-export entries
      if (exp.name.startsWith('* from ')) continue;

      if (isConsumedByEdge(exp.name, file.relativePath, allEdges)) continue;

      const consumerCandidates = getConsumerCandidates(file.path);

      if (isReexportedByBarrel(exp.name, consumerCandidates)) continue;
      if (isConsumedExternally(exp.name, file.path, consumerCandidates)) continue;

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

/** Check whether a source file imports or re-exports from the given target path. */
function fileReferencesTarget(candidateSf: SourceFile, targetPath: string): boolean {
  for (const imp of candidateSf.getImportDeclarations()) {
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved && resolved.getFilePath() === targetPath) return true;
  }
  for (const exp of candidateSf.getExportDeclarations()) {
    const resolved = exp.getModuleSpecifierSourceFile();
    if (resolved && resolved.getFilePath() === targetPath) return true;
  }
  return false;
}

function findConsumersForFile(targetFile: FileNode, searchDir?: string): FileNode[] {
  const consumers: FileNode[] = [];
  const candidatePaths = searchDir ? findConsumerFiles(targetFile.path, searchDir) : findConsumerFiles(targetFile.path);

  for (const candidatePath of candidatePaths) {
    try {
      const candidateSf = getSourceFile(candidatePath);
      if (fileReferencesTarget(candidateSf, targetFile.path)) {
        consumers.push(analyzeFile(candidatePath));
      }
    } catch (error) {
      process.stderr.write(
        `[ast-imports] findConsumersForFile: could not load ${candidatePath}: ${error instanceof Error ? error.message : error}\n`,
      );
    }
  }

  return consumers;
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

function extractStaticImportObservations(file: FileNode): ImportObservation[] {
  const observations: ImportObservation[] = [];

  for (const imp of file.imports) {
    // Skip dynamic imports (those with '*' specifiers are usually dynamic)
    // Side-effect imports have empty specifiers
    const isSideEffect = imp.specifiers.length === 0;
    const isDynamic = imp.specifiers.length === 1 && imp.specifiers[0] === '*';

    if (isSideEffect) {
      observations.push({
        kind: 'SIDE_EFFECT_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: {
          source: imp.source,
          specifiers: imp.specifiers,
          isTypeOnly: imp.isTypeOnly,
        },
      });
    } else if (isDynamic) {
      observations.push({
        kind: 'DYNAMIC_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: {
          source: imp.source,
          specifiers: imp.specifiers,
          isTypeOnly: imp.isTypeOnly,
        },
      });
    } else {
      observations.push({
        kind: 'STATIC_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: {
          source: imp.source,
          specifiers: imp.specifiers,
          isTypeOnly: imp.isTypeOnly,
        },
      });
    }
  }

  return observations;
}

function extractExportObservations(file: FileNode): ImportObservation[] {
  const observations: ImportObservation[] = [];

  for (const exp of file.exports) {
    if (exp.kind === 'reexport') {
      observations.push({
        kind: 'REEXPORT_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: exp.line,
        evidence: {
          exportName: exp.name,
          exportKind: exp.kind,
          isTypeOnly: exp.isTypeOnly,
        },
      });
    } else {
      observations.push({
        kind: 'EXPORT_DECLARATION' as ImportObservationKind,
        file: file.relativePath,
        line: exp.line,
        evidence: {
          exportName: exp.name,
          exportKind: exp.kind,
          isTypeOnly: exp.isTypeOnly,
        },
      });
    }
  }

  return observations;
}

function extractCircularDependencyObservations(circularDeps: string[][], files: FileNode[]): ImportObservation[] {
  const observations: ImportObservation[] = [];
  const fileMap = new Map(files.map(f => [f.relativePath, f]));

  for (const cycle of circularDeps) {
    if (cycle.length > 0) {
      const firstFile = fileMap.get(cycle[0]);
      observations.push({
        kind: 'CIRCULAR_DEPENDENCY' as ImportObservationKind,
        file: cycle[0],
        line: firstFile?.imports[0]?.line ?? 1,
        evidence: {
          cyclePath: cycle,
        },
      });
    }
  }

  return observations;
}

function extractDeadExportObservations(
  deadExports: Array<{ file: string; export: string; line: number }>,
): ImportObservation[] {
  return deadExports.map(dead => ({
    kind: 'DEAD_EXPORT_CANDIDATE' as ImportObservationKind,
    file: dead.file,
    line: dead.line,
    evidence: {
      exportName: dead.export,
      consumerCount: 0,
      isBarrelReexported: false,
      isNextJsPage: false,
    },
  }));
}

/**
 * Extract import/export observations from a SourceFile without reading from disk.
 * Produces STATIC_IMPORT, DYNAMIC_IMPORT, SIDE_EFFECT_IMPORT, EXPORT_DECLARATION,
 * and REEXPORT_IMPORT observations. Does NOT produce CIRCULAR_DEPENDENCY or
 * DEAD_EXPORT_CANDIDATE (both require multi-file analysis and are in ignoredKinds
 * for the intention matcher).
 *
 * Use this instead of buildDependencyGraph + extractImportObservations when you
 * have a SourceFile in memory (e.g., virtual project for HEAD content).
 */
export function extractImportObservationsFromSource(
  sf: SourceFile,
  filePath: string,
): ObservationResult<ImportObservation> {
  const relativePath = path.isAbsolute(filePath) ? path.relative(PROJECT_ROOT, filePath) : filePath;

  const regularImports = extractImports(sf);
  const dynamicImports = extractDynamicImports(sf);
  const reexportImports = extractReexportImports(sf);

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

  const fileNode: FileNode = {
    path: path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath),
    relativePath,
    imports: allImports,
    exports,
  };

  const observations: ImportObservation[] = [];
  observations.push(...extractStaticImportObservations(fileNode));
  observations.push(...extractExportObservations(fileNode));

  return { filePath: relativePath, observations };
}

/**
 * Extract observations from a dependency graph.
 * This is the observation-layer API for ast-imports.
 */
export function extractImportObservations(graph: DependencyGraph): ObservationResult<ImportObservation> {
  const allObservations: ImportObservation[] = [];

  // Per-file observations
  for (const file of graph.files) {
    allObservations.push(...extractStaticImportObservations(file));
    allObservations.push(...extractExportObservations(file));
  }

  // Cross-file observations
  allObservations.push(...extractCircularDependencyObservations(graph.circularDeps, graph.files));
  allObservations.push(...extractDeadExportObservations(graph.deadExports));

  return {
    filePath: graph.files.length > 0 ? graph.files[0].relativePath : '',
    observations: allObservations,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildDependencyGraph(
  targetPath: string,
  options?: { searchDir?: string; filter?: FileFilter },
): DependencyGraph {
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  const stat = fs.statSync(absolute);
  const isDirectory = stat.isDirectory();
  const searchDir = options?.searchDir;

  let files: FileNode[];

  if (isDirectory) {
    const filePaths = getFilesInDirectory(absolute, options?.filter ?? 'production');
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
  const args = parseArgs(process.argv, {
    namedOptions: ['--consumers', '--symbol'],
  });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-imports.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '       npx tsx scripts/AST/ast-imports.ts --consumers <file> [--pretty]\n' +
        '       npx tsx scripts/AST/ast-imports.ts <path...> --symbol <name> [--pretty]\n' +
        '\n' +
        'Analyze imports, exports, and dependency relationships.\n' +
        '\n' +
        '  <path...>     One or more files or directories to analyze\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --no-cache    Bypass cache and recompute (no-op for this tool)\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n' +
        '  --consumers   Find all files that import the given file (reverse lookup)\n' +
        '  --symbol      Filter STATIC_IMPORT to files importing a specific named export\n' +
        '                e.g., --symbol filterOutAdminUids shows only files that import that symbol\n',
    );
    process.exit(0);
  }

  // --consumers mode: reverse lookup (find importers of a given file)
  if (args.options.consumers) {
    const targetPath = args.options.consumers;
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const targetFile = analyzeFile(absolute);
    const consumers = findConsumersForFile(targetFile);
    const consumerPaths = consumers.map(c => c.relativePath);

    if (args.pretty) {
      process.stdout.write(JSON.stringify(consumerPaths, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(consumerPaths) + '\n');
    }
    return;
  }

  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allGraphs: DependencyGraph[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    allGraphs.push(buildDependencyGraph(targetPath, { filter: testFiles ? 'test' : 'production' }));
  }

  // --symbol mode: filter to files importing a specific named export
  if (args.options.symbol) {
    const symbol = args.options.symbol;
    const matchingFiles: Array<{ file: string; source: string; line: number; specifiers: string[] }> = [];

    for (const graph of allGraphs) {
      for (const file of graph.files) {
        for (const imp of file.imports) {
          if (imp.specifiers.some(s => s === symbol || s.startsWith(`${symbol} as `))) {
            matchingFiles.push({
              file: file.relativePath,
              source: imp.source,
              line: imp.line,
              specifiers: imp.specifiers,
            });
          }
        }
      }
    }

    const output = {
      symbol,
      consumers: matchingFiles.length,
      files: matchingFiles,
    };
    process.stdout.write(JSON.stringify(output, null, args.pretty ? 2 : 0) + '\n');
    return;
  }

  const useObservations = args.options.kind || args.flags.has('count');
  const result = useObservations
    ? allGraphs.length === 1
      ? extractImportObservations(allGraphs[0])
      : allGraphs.map(g => extractImportObservations(g))
    : allGraphs.length === 1
      ? allGraphs[0]
      : allGraphs;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-imports.ts') || process.argv[1].endsWith('ast-imports'));

if (isDirectRun) {
  main();
}
