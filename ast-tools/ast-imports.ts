import { type SourceFile, type ExportedDeclarations, SyntaxKind, Node } from 'ts-morph';
import ts from 'typescript';
import path from 'path';
import fs from 'fs';
import { getSourceFile, findConsumerFiles, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, type FileFilter } from './shared';
import { astConfig } from './ast-config';
import { cachedDirectory } from './ast-cache';
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
// Import extraction (ts-morph -- used by extractImportObservationsFromSource)
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
// Dynamic import extraction (ts-morph)
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
// Export extraction (ts-morph)
// ---------------------------------------------------------------------------

/** Maps a ts-morph Node guard to the ExportInfo kind it implies. */
const DECLARATION_KIND_CHECKS: {
  guard: (node: Node) => boolean;
  kind: ExportInfo['kind'];
}[] = [
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
// Import re-exports (ts-morph -- used by extractImportObservationsFromSource)
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
// Module resolution (ts.resolveModuleName -- no ts-morph Project needed)
// ---------------------------------------------------------------------------

/** Cached TypeScript compiler options and resolution host for ts.resolveModuleName(). */
let cachedCompilerOptions: ts.CompilerOptions | null = null;
let cachedModuleResolutionHost: ts.ModuleResolutionHost | null = null;

function getCompilerResolutionContext(): { options: ts.CompilerOptions; host: ts.ModuleResolutionHost } {
  if (cachedCompilerOptions && cachedModuleResolutionHost) {
    return { options: cachedCompilerOptions, host: cachedModuleResolutionHost };
  }

  const configPath = path.join(PROJECT_ROOT, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, p => ts.sys.readFile(p));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, PROJECT_ROOT);
  cachedCompilerOptions = parsed.options;

  // Cache fileExists results to avoid redundant filesystem calls.
  // ts.resolveModuleName tries many path variants per import (~5-10 each).
  // With ~7000 imports, this prevents ~50,000+ redundant syscalls.
  const fileExistsCache = new Map<string, boolean>();
  cachedModuleResolutionHost = {
    fileExists(fileName: string): boolean {
      let result = fileExistsCache.get(fileName);
      if (result === undefined) {
        result = ts.sys.fileExists(fileName);
        fileExistsCache.set(fileName, result);
      }
      return result;
    },
    readFile: (p: string) => ts.sys.readFile(p),
  };

  return { options: cachedCompilerOptions, host: cachedModuleResolutionHost };
}

/**
 * Resolve a module specifier using the TypeScript compiler's module resolution.
 * This is lightweight: no files need to be loaded into a Project. It uses
 * tsconfig.json paths and filesystem lookups.
 *
 * Results are cached by (importSource, containingDir) since many files in the
 * same directory import the same modules.
 */
const resolveCache = new Map<string, string | null>();

function resolveViaCompiler(importSource: string, importingFilePath: string): string | null {
  const dir = path.dirname(importingFilePath);
  const cacheKey = `${importSource}\0${dir}`;
  const cached = resolveCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const { options, host } = getCompilerResolutionContext();
  const result = ts.resolveModuleName(importSource, importingFilePath, options, host);
  const resolved = result.resolvedModule ? result.resolvedModule.resolvedFileName : null;
  resolveCache.set(cacheKey, resolved);
  return resolved;
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

/**
 * Resolve an import source string to an absolute file path.
 *
 * Primary strategy: ts.resolveModuleName() which uses the TypeScript compiler's
 * module resolution algorithm with tsconfig paths. Lightweight -- no files need
 * to be loaded into a ts-morph Project. Does not trigger lazy loading.
 *
 * Fallback: resolveRelativeFallback for relative imports the compiler misses.
 */
function resolveModulePath(importSource: string, importingFilePath: string): string | null {
  const pathAliasPrefix = astConfig.fileDiscovery.pathAliasPrefix;
  if (!importSource.startsWith('.') && !importSource.startsWith(pathAliasPrefix)) {
    return null;
  }

  const fromCompiler = resolveViaCompiler(importSource, importingFilePath);
  if (fromCompiler) return fromCompiler;

  if (importSource.startsWith('.')) {
    return resolveRelativeFallback(importSource, importingFilePath);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Raw TypeScript AST extraction (no ts-morph Project needed)
// ---------------------------------------------------------------------------
// These functions use ts.createSourceFile (lightweight parser, ~50-200KB per
// file) instead of ts-morph's Project.addSourceFileAtPath (~0.7-1.5MB per
// file). Used by extractFileNodes for the hot path. The ts-morph versions
// above are retained for traceBarrelChain and extractImportObservationsFromSource.

/** Get 1-based line number from a raw TS node position. */
function rawLine(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

/** Collect specifier strings from a raw TS import declaration. */
function rawCollectImportSpecifiers(decl: ts.ImportDeclaration): string[] {
  const specifiers: string[] = [];
  const clause = decl.importClause;
  if (!clause) return specifiers;

  if (clause.name) {
    specifiers.push(clause.name.text);
  }

  const bindings = clause.namedBindings;
  if (bindings) {
    if (ts.isNamespaceImport(bindings)) {
      specifiers.push(`* as ${bindings.name.text}`);
    } else if (ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const alias = el.propertyName ? `${el.propertyName.text} as ${el.name.text}` : el.name.text;
        specifiers.push(alias);
      }
    }
  }

  return specifiers;
}

function rawExtractImports(sf: ts.SourceFile): ImportInfo[] {
  const merged = new Map<string, ImportInfo>();

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const source = stmt.moduleSpecifier.text;
    const specifiers = rawCollectImportSpecifiers(stmt);
    const isTypeOnly = stmt.importClause?.isTypeOnly ?? false;
    const line = rawLine(sf, stmt.getStart());

    mergeImportEntry(merged, source, specifiers, isTypeOnly, line);
  }

  return Array.from(merged.values());
}

function rawExtractDynamicImports(sf: ts.SourceFile): ImportInfo[] {
  const results: ImportInfo[] = [];

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        results.push({
          source: arg.text,
          specifiers: ['*'],
          isTypeOnly: false,
          line: rawLine(sf, node.getStart()),
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sf, visit);
  return results;
}

function rawExtractReexportImports(sf: ts.SourceFile): ImportInfo[] {
  const imports: ImportInfo[] = [];

  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const source = stmt.moduleSpecifier.text;
    const specifiers: string[] = [];
    const isTypeOnly = stmt.isTypeOnly;

    if (!stmt.exportClause) {
      specifiers.push('*');
    } else if (ts.isNamespaceExport(stmt.exportClause)) {
      specifiers.push('*');
    } else if (ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        specifiers.push((el.propertyName ?? el.name).text);
      }
    }

    imports.push({ source, specifiers, isTypeOnly, line: rawLine(sf, stmt.getStart()) });
  }

  return imports;
}

/** Classify a raw TS declaration node to an ExportInfo kind. */
function rawClassifyDeclaration(node: ts.Node): ExportInfo['kind'] {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableDeclaration(node)) {
    const init = node.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) return 'function';
    return 'const';
  }
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl) return rawClassifyDeclaration(decl);
    return 'const';
  }
  return 'const';
}

/**
 * Collect the direct (non-transitive) export names from a raw TS SourceFile.
 * Does NOT follow export * chains -- that's the caller's job.
 */
function rawCollectDirectExportNames(sf: ts.SourceFile): ExportInfo[] {
  const results: ExportInfo[] = [];

  for (const stmt of sf.statements) {
    // ExportDeclaration and ExportAssignment do not carry the export keyword
    // as a modifier -- check them before the modifier guard.
    if (ts.isExportDeclaration(stmt)) {
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          results.push({
            name: el.name.text,
            kind: stmt.moduleSpecifier ? 'reexport' : 'const',
            isTypeOnly: stmt.isTypeOnly,
            line: rawLine(sf, el.getStart()),
          });
        }
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      results.push({ name: 'default', kind: 'default', isTypeOnly: false, line: rawLine(sf, stmt.getStart()) });
      continue;
    }

    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
    if (isDefault) {
      const kind = rawClassifyDeclaration(stmt);
      results.push({
        name: 'default',
        kind: kind === 'const' ? 'default' : kind,
        isTypeOnly: false,
        line: rawLine(sf, stmt.getStart()),
      });
      continue;
    }

    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      const name = stmt.name?.text;
      if (name) {
        const kind = rawClassifyDeclaration(stmt);
        const isTypeOnly = kind === 'type' || kind === 'interface';
        results.push({ name, kind, isTypeOnly, line: rawLine(sf, stmt.getStart()) });
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) {
          results.push({
            name: decl.name.text,
            kind: rawClassifyDeclaration(decl),
            isTypeOnly: false,
            line: rawLine(sf, decl.getStart()),
          });
        }
      }
    }
  }

  return results;
}

/**
 * Resolve the actual declaration kind of a named re-export by following
 * the chain: `export { Foo } from './a'` where a has `export { Foo } from './b'`
 * etc. Returns the declared kind (function, type, const...) or null if
 * unresolvable. Depth-limited to prevent runaway chains.
 */
function resolveNamedExportKind(
  name: string,
  filePath: string,
  maxDepth = 4,
  seen = new Set<string>(),
): { kind: ExportInfo['kind']; isTypeOnly: boolean } | null {
  if (maxDepth <= 0 || seen.has(filePath)) return null;
  seen.add(filePath);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }

  const sf = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  // Check direct declarations first
  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && name === 'default') {
      return { kind: 'default', isTypeOnly: false };
    }

    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
    if (isDefault && name === 'default') {
      const kind = rawClassifyDeclaration(stmt);
      return { kind: kind === 'const' ? 'default' : kind, isTypeOnly: false };
    }

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === name
    ) {
      const kind = rawClassifyDeclaration(stmt);
      return { kind, isTypeOnly: kind === 'type' || kind === 'interface' };
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return { kind: rawClassifyDeclaration(decl), isTypeOnly: false };
        }
      }
    }
  }

  // Check named re-exports: follow the chain
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;

    for (const el of stmt.exportClause.elements) {
      const exportName = el.name.text;
      if (exportName !== name) continue;
      const localName = (el.propertyName ?? el.name).text;
      const targetPath = resolveModulePath(stmt.moduleSpecifier.text, filePath);
      if (targetPath) {
        const result = resolveNamedExportKind(localName, targetPath, maxDepth - 1, seen);
        if (result) {
          return { kind: result.kind, isTypeOnly: stmt.isTypeOnly || result.isTypeOnly };
        }
      }
    }
  }

  // Check star re-exports: the name might be transitively available
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.exportClause) continue; // Not star
    const targetPath = resolveModulePath(stmt.moduleSpecifier.text, filePath);
    if (targetPath) {
      const result = resolveNamedExportKind(name, targetPath, maxDepth - 1, seen);
      if (result) return result;
    }
  }

  return null;
}

/**
 * Resolve export * by following the chain: parse the target file, collect its
 * exports (including its own export * targets, recursively). Each target is
 * parsed with ts.createSourceFile (~50-200KB, immediately GC-eligible).
 * Visited set prevents infinite loops on circular re-export chains.
 */
function resolveStarExports(moduleSpecifier: string, containingFilePath: string, visited: Set<string>): ExportInfo[] {
  const resolvedPath = resolveModulePath(moduleSpecifier, containingFilePath);
  if (!resolvedPath || visited.has(resolvedPath)) return [];
  visited.add(resolvedPath);

  let content: string;
  try {
    content = fs.readFileSync(resolvedPath, 'utf-8');
  } catch {
    return [];
  }

  const targetSf = ts.createSourceFile(resolvedPath, content, ts.ScriptTarget.Latest, true);
  const directExports = rawCollectDirectExportNames(targetSf);

  // Resolve named re-exports to actual declaration kinds by following
  // the re-export chain recursively (up to 4 levels deep).
  for (const exp of directExports) {
    if (exp.kind !== 'reexport') continue;

    // Find the ExportDeclaration statement that produced this entry
    for (const stmt of targetSf.statements) {
      if (!ts.isExportDeclaration(stmt)) continue;
      if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) continue;

      for (const el of stmt.exportClause.elements) {
        if (el.name.text !== exp.name) continue;
        const localName = (el.propertyName ?? el.name).text;
        const targetPath = resolveModulePath(stmt.moduleSpecifier.text, resolvedPath);
        if (!targetPath) continue;
        const resolved = resolveNamedExportKind(localName, targetPath);
        if (resolved) {
          exp.kind = resolved.kind;
          exp.isTypeOnly = exp.isTypeOnly || resolved.isTypeOnly;
        }
      }
    }
  }

  // Recursively resolve export * in the target
  for (const stmt of targetSf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.exportClause) continue; // Named re-export, not star

    const nested = resolveStarExports(stmt.moduleSpecifier.text, resolvedPath, visited);
    directExports.push(...nested);
  }

  return directExports;
}

function rawExtractExports(sf: ts.SourceFile, filePath: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const reexportedNames = new Set<string>();
  const visited = new Set<string>([filePath]);

  // First pass: collect re-export entries and resolve export * chains
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (!stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;

    const moduleSpecifier = stmt.moduleSpecifier.text;
    const isTypeOnly = stmt.isTypeOnly;
    const line = rawLine(sf, stmt.getStart());

    if (stmt.exportClause && ts.isNamespaceExport(stmt.exportClause)) {
      // Namespace re-export: export * as X from './module'
      // Creates a single named export (the namespace object), NOT individual re-exports.
      const nsName = stmt.exportClause.name.text;
      reexportedNames.add(nsName);
      exports.push({ name: nsName, kind: 'const', isTypeOnly, line });
    } else if (!stmt.exportClause) {
      // Star re-export: export * from './module'
      // Keep the * entry AND resolve individual names.
      exports.push({ name: `* from ${moduleSpecifier}`, kind: 'reexport', isTypeOnly, line });

      // Follow the chain to enumerate individual exported names.
      // Preserve the original kind from the source file (function, const, type, etc.)
      // so dead-export detection can check these names individually.
      const resolved = resolveStarExports(moduleSpecifier, filePath, visited);
      for (const exp of resolved) {
        if (!reexportedNames.has(exp.name)) {
          reexportedNames.add(exp.name);
          exports.push({ name: exp.name, kind: exp.kind, isTypeOnly: isTypeOnly || exp.isTypeOnly, line });
        }
      }
    } else if (ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) {
        const exportName = el.name.text;
        reexportedNames.add(exportName);
        exports.push({ name: exportName, kind: 'reexport', isTypeOnly, line });
      }
    }
  }

  // Second pass: collect declared exports from statements.
  // ExportDeclaration and ExportAssignment do not carry the export keyword
  // as a modifier, so check them before the modifier guard.
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      // Handle local named exports: export { foo, bar }
      if (!stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          const exportName = el.name.text;
          if (!reexportedNames.has(exportName)) {
            exports.push({
              name: exportName,
              kind: 'const',
              isTypeOnly: stmt.isTypeOnly,
              line: rawLine(sf, el.getStart()),
            });
          }
        }
      }
      continue;
    }

    if (ts.isExportAssignment(stmt)) {
      exports.push({ name: 'default', kind: 'default', isTypeOnly: false, line: rawLine(sf, stmt.getStart()) });
      continue;
    }

    const modifiers = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) : undefined;
    const hasExport = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!hasExport) continue;

    const isDefault = modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

    if (isDefault) {
      const kind = rawClassifyDeclaration(stmt);
      exports.push({
        name: 'default',
        kind: kind === 'const' ? 'default' : kind,
        isTypeOnly: false,
        line: rawLine(sf, stmt.getStart()),
      });
      continue;
    }

    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isTypeAliasDeclaration(stmt) ||
      ts.isInterfaceDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      const name = stmt.name?.text;
      if (name) {
        const kind = rawClassifyDeclaration(stmt);
        const isTypeOnly = kind === 'type' || kind === 'interface';
        if (reexportedNames.has(name)) {
          const existing = exports.find(e => e.name === name && e.kind !== 'reexport');
          if (existing) existing.kind = 'reexport';
        } else if (!exports.some(e => e.name === name)) {
          // Deduplicate: declaration merging (type + const with same name)
          exports.push({ name, kind, isTypeOnly, line: rawLine(sf, stmt.getStart()) });
        }
      }
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const names: { name: string; line: number }[] = [];
        if (ts.isIdentifier(decl.name)) {
          names.push({ name: decl.name.text, line: rawLine(sf, decl.getStart()) });
        } else if (ts.isObjectBindingPattern(decl.name)) {
          // Destructured: export const { a, b } = ...
          for (const el of decl.name.elements) {
            if (ts.isBindingElement(el) && ts.isIdentifier(el.name)) {
              names.push({ name: el.name.text, line: rawLine(sf, el.getStart()) });
            }
          }
        }
        for (const { name, line: declLine } of names) {
          const kind = rawClassifyDeclaration(decl);
          if (reexportedNames.has(name)) {
            const existing = exports.find(e => e.name === name && e.kind !== 'reexport');
            if (existing) existing.kind = 'reexport';
          } else if (!exports.some(e => e.name === name)) {
            exports.push({ name, kind, isTypeOnly: false, line: declLine });
          }
        }
      }
    }
  }

  return exports;
}

/**
 * Analyze a file using the raw TypeScript parser (no ts-morph Project).
 * Reads from disk, parses with ts.createSourceFile, extracts imports/exports,
 * resolves via ts.resolveModuleName. Peak memory: ~50-200KB per file.
 */
function analyzeFileRaw(filePath: string): FileNode {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const content = fs.readFileSync(absPath, 'utf-8');
  const sf = ts.createSourceFile(absPath, content, ts.ScriptTarget.Latest, true);
  const relativePath = path.relative(PROJECT_ROOT, absPath);

  const regularImports = rawExtractImports(sf);
  const dynamicImports = rawExtractDynamicImports(sf);
  const reexportImports = rawExtractReexportImports(sf);

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

  // Eager resolution via ts.resolveModuleName (no Project needed)
  for (const imp of allImports) {
    const resolved = resolveModulePath(imp.source, absPath);
    if (resolved) {
      imp.resolvedPath = resolved;
    }
  }

  const exports = rawExtractExports(sf, absPath);

  return { path: absPath, relativePath, imports: allImports, exports };
}

// ---------------------------------------------------------------------------
// File analysis (ts-morph -- legacy path for traceBarrelChain)
// ---------------------------------------------------------------------------

function analyzeFile(filePath: string): FileNode {
  const sf = getSourceFile(filePath);
  const absPath = sf.getFilePath();
  const relativePath = path.relative(PROJECT_ROOT, absPath);

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

  // Eager resolution so buildEdges can read imp.resolvedPath
  for (const imp of allImports) {
    const resolved = resolveModulePath(imp.source, absPath);
    if (resolved) {
      imp.resolvedPath = resolved;
    }
  }

  const exports = extractExports(sf);

  return { path: absPath, relativePath, imports: allImports, exports };
}

// ---------------------------------------------------------------------------
// Batch extraction (raw TS -- the hot path)
// ---------------------------------------------------------------------------

/**
 * Extract FileNodes from a list of file paths using the raw TypeScript parser.
 *
 * No ts-morph Project is created. Each file is read from disk, parsed with
 * ts.createSourceFile (~50-200KB per file), extracted, and resolved. The raw
 * AST is GC'd immediately after extraction. Peak memory: O(1) per file +
 * accumulated FileNode metadata.
 */
function extractFileNodes(filePaths: string[]): FileNode[] {
  const results: FileNode[] = [];

  for (const fp of filePaths) {
    try {
      results.push(analyzeFileRaw(fp));
    } catch (error) {
      process.stderr.write(
        `[ast-imports] extractFileNodes: could not analyze ${fp}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Edge building
// ---------------------------------------------------------------------------

/**
 * Build directed edges from the file list.
 * Uses pre-resolved resolvedPath from eager resolution in analyzeFileRaw.
 * Pure data read with zero AST access.
 */
function buildEdges(files: FileNode[]): { from: string; to: string; specifiers: string[] }[] {
  const edges: { from: string; to: string; specifiers: string[] }[] = [];

  for (const file of files) {
    for (const imp of file.imports) {
      const resolved = imp.resolvedPath;
      if (resolved) {
        const to = path.relative(PROJECT_ROOT, resolved);
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

function detectCircularDeps(edges: { from: string; to: string; specifiers: string[] }[]): string[][] {
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
        const cycleStart = pathStack.indexOf(neighbor);
        if (cycleStart !== -1) {
          const cycle = pathStack.slice(cycleStart);
          cycle.push(neighbor);
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
// Barrel chain resolution (ts-morph -- exported for other tools, NOT in scope)
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
      `[ast-imports] traceBarrelChain: could not load barrel file ${filePath}: ${error instanceof Error ? error.message : String(error)}\n`,
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

/** Check if any edge in the graph imports this export name from this file. */
function isConsumedByEdge(
  exportName: string,
  fileRelativePath: string,
  allEdges: { from: string; to: string; specifiers: string[] }[],
): boolean {
  return allEdges.some(
    e =>
      e.to === fileRelativePath &&
      (e.specifiers.includes(exportName) || e.specifiers.includes('*') || e.specifiers.includes(`* as ${exportName}`)),
  );
}

/**
 * Check if any barrel file re-exports this name.
 * Uses pre-extracted FileNode data when available (allFiles map).
 */
function isReexportedByBarrel(
  exportName: string,
  consumerCandidates: string[],
  allFiles?: Map<string, FileNode>,
): boolean {
  return consumerCandidates.some(consumer => {
    if (!isBarrelFile(consumer)) return false;

    const fileNode = allFiles?.get(consumer);
    if (fileNode) {
      return fileNode.exports.some(
        exp => exp.kind === 'reexport' && (exp.name === exportName || exp.name.startsWith('* from ')),
      );
    }

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
        `[ast-imports] isReexportedByBarrel: could not check re-exports in ${consumer}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return false;
  });
}

/**
 * Check if a single consumer file imports the given export name from filePath.
 * Uses pre-extracted FileNode data when available.
 */
function consumerImportsName(
  consumer: string,
  exportName: string,
  filePath: string,
  allFiles?: Map<string, FileNode>,
): boolean {
  const fileNode = allFiles?.get(consumer);
  if (fileNode) {
    return fileNode.imports.some(imp => {
      if (imp.resolvedPath !== filePath) return false;
      if (imp.specifiers.includes(exportName)) return true;
      if (imp.specifiers.includes('*')) return true;
      if (imp.specifiers.some(s => s.startsWith('* as '))) return true;
      // Default export: any import from this file conservatively counts
      if (exportName === 'default') return true;
      return false;
    });
  }

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
function isConsumedExternally(
  exportName: string,
  filePath: string,
  consumerCandidates: string[],
  allFiles?: Map<string, FileNode>,
): boolean {
  return consumerCandidates.some(consumer => {
    try {
      return consumerImportsName(consumer, exportName, filePath, allFiles);
    } catch (error) {
      process.stderr.write(
        `[ast-imports] isConsumedExternally: could not check external consumers of ${consumer}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
    return false;
  });
}

function detectDeadExports(
  files: FileNode[],
  allEdges: { from: string; to: string; specifiers: string[] }[],
  fixtureSearchDir?: string,
  allFiles?: Map<string, FileNode>,
): { file: string; export: string; line: number }[] {
  const dead: { file: string; export: string; line: number }[] = [];
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
    if (isNextJsPage(file.path)) continue;

    for (const exp of file.exports) {
      if (exp.kind === 'reexport') continue;
      if (exp.name.startsWith('* from ')) continue;

      if (isConsumedByEdge(exp.name, file.relativePath, allEdges)) continue;

      const consumerCandidates = getConsumerCandidates(file.path);

      if (isReexportedByBarrel(exp.name, consumerCandidates, allFiles)) continue;
      if (isConsumedExternally(exp.name, file.path, consumerCandidates, allFiles)) continue;

      dead.push({ file: file.relativePath, export: exp.name, line: exp.line });
    }
  }

  return dead;
}

// ---------------------------------------------------------------------------
// Consumer detection
// ---------------------------------------------------------------------------

/** Check whether a source file imports or re-exports from the given target path. */
function fileReferencesTarget(candidateSf: SourceFile, targetPath: string): boolean {
  for (const imp of candidateSf.getImportDeclarations()) {
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved?.getFilePath() === targetPath) return true;
  }
  for (const exp of candidateSf.getExportDeclarations()) {
    const resolved = exp.getModuleSpecifierSourceFile();
    if (resolved?.getFilePath() === targetPath) return true;
  }
  return false;
}

/**
 * Find all files that import or re-export from the target file.
 * Uses pre-extracted FileNode data when available (allFiles map).
 */
function findConsumersForFile(targetFile: FileNode, searchDir?: string, allFiles?: Map<string, FileNode>): FileNode[] {
  const consumers: FileNode[] = [];
  const candidatePaths = searchDir ? findConsumerFiles(targetFile.path, searchDir) : findConsumerFiles(targetFile.path);

  for (const candidatePath of candidatePaths) {
    try {
      const candidateNode = allFiles?.get(candidatePath);
      if (candidateNode) {
        const referencesTarget = candidateNode.imports.some(imp => imp.resolvedPath === targetFile.path);
        if (referencesTarget) {
          consumers.push(candidateNode);
        }
        continue;
      }

      const candidateSf = getSourceFile(candidatePath);
      if (fileReferencesTarget(candidateSf, targetFile.path)) {
        consumers.push(analyzeFile(candidatePath));
      }
    } catch (error) {
      process.stderr.write(
        `[ast-imports] findConsumersForFile: could not load ${candidatePath}: ${error instanceof Error ? error.message : String(error)}\n`,
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
    const isSideEffect = imp.specifiers.length === 0;
    const isDynamic = imp.specifiers.length === 1 && imp.specifiers[0] === '*';

    if (isSideEffect) {
      observations.push({
        kind: 'SIDE_EFFECT_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: { source: imp.source, specifiers: imp.specifiers, isTypeOnly: imp.isTypeOnly },
      });
    } else if (isDynamic) {
      observations.push({
        kind: 'DYNAMIC_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: { source: imp.source, specifiers: imp.specifiers, isTypeOnly: imp.isTypeOnly },
      });
    } else {
      observations.push({
        kind: 'STATIC_IMPORT' as ImportObservationKind,
        file: file.relativePath,
        line: imp.line,
        evidence: { source: imp.source, specifiers: imp.specifiers, isTypeOnly: imp.isTypeOnly },
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
        evidence: { exportName: exp.name, exportKind: exp.kind, isTypeOnly: exp.isTypeOnly },
      });
    } else {
      observations.push({
        kind: 'EXPORT_DECLARATION' as ImportObservationKind,
        file: file.relativePath,
        line: exp.line,
        evidence: { exportName: exp.name, exportKind: exp.kind, isTypeOnly: exp.isTypeOnly },
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
        evidence: { cyclePath: cycle },
      });
    }
  }

  return observations;
}

function extractDeadExportObservations(
  deadExports: { file: string; export: string; line: number }[],
): ImportObservation[] {
  return deadExports.map(dead => ({
    kind: 'DEAD_EXPORT_CANDIDATE' as ImportObservationKind,
    file: dead.file,
    line: dead.line,
    evidence: { exportName: dead.export, consumerCount: 0, isBarrelReexported: false, isNextJsPage: false },
  }));
}

/**
 * Extract import/export observations from a SourceFile without reading from disk.
 * Uses ts-morph (not raw TS) because callers pass a ts-morph SourceFile.
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

export function extractImportObservations(graph: DependencyGraph): ObservationResult<ImportObservation> {
  const allObservations: ImportObservation[] = [];

  for (const file of graph.files) {
    allObservations.push(...extractStaticImportObservations(file));
    allObservations.push(...extractExportObservations(file));
  }

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

/** Compute a dependency graph without caching. */
function computeDependencyGraph(
  absolute: string,
  isDirectory: boolean,
  searchDir?: string,
  filter?: FileFilter,
): DependencyGraph {
  let files: FileNode[];

  if (isDirectory) {
    const filePaths = getFilesInDirectory(absolute, filter ?? 'production');

    files = extractFileNodes(filePaths);

    const filePathSet = new Set(files.map(f => f.path));
    const consumerCandidatePaths: string[] = [];
    for (const file of files) {
      const candidates = searchDir ? findConsumerFiles(file.path, searchDir) : findConsumerFiles(file.path);
      for (const c of candidates) {
        if (!filePathSet.has(c) && !consumerCandidatePaths.includes(c)) {
          consumerCandidatePaths.push(c);
        }
      }
    }

    const consumerFileNodes = extractFileNodes(consumerCandidatePaths);

    const allFilesMap = new Map<string, FileNode>();
    for (const f of files) allFilesMap.set(f.path, f);
    for (const node of consumerFileNodes) allFilesMap.set(node.path, node);

    const allConsumers: FileNode[] = [];
    for (const node of consumerFileNodes) {
      const referencesAnyTarget = node.imports.some(imp => imp.resolvedPath && filePathSet.has(imp.resolvedPath));
      if (referencesAnyTarget && !filePathSet.has(node.path)) {
        allConsumers.push(node);
        filePathSet.add(node.path);
      }
    }
    files.push(...allConsumers);

    const edges = buildEdges(files);
    const circularDeps = detectCircularDeps(edges);
    const deadExports = detectDeadExports(
      files.filter(f => f.path.startsWith(absolute)),
      edges,
      searchDir,
      allFilesMap,
    );

    return { files, edges, circularDeps, deadExports };
  } else {
    const [targetFile] = extractFileNodes([absolute]);
    files = [targetFile];

    const candidatePaths = searchDir
      ? findConsumerFiles(targetFile.path, searchDir)
      : findConsumerFiles(targetFile.path);
    const consumerFileNodes = extractFileNodes(candidatePaths);
    const allFilesMap = new Map<string, FileNode>();
    allFilesMap.set(targetFile.path, targetFile);

    const filePathSet = new Set([targetFile.path]);
    for (const node of consumerFileNodes) {
      allFilesMap.set(node.path, node);
      const referencesTarget = node.imports.some(imp => imp.resolvedPath === targetFile.path);
      if (referencesTarget && !filePathSet.has(node.path)) {
        files.push(node);
        filePathSet.add(node.path);
      }
    }

    const edges = buildEdges(files);
    const circularDeps = detectCircularDeps(edges);
    const deadExports = detectDeadExports([files[0]], edges, searchDir, allFilesMap);

    return { files, edges, circularDeps, deadExports };
  }
}

export function buildDependencyGraph(
  targetPath: string,
  options?: { searchDir?: string; filter?: FileFilter; noCache?: boolean },
): DependencyGraph {
  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  const stat = fs.statSync(absolute);
  const isDirectory = stat.isDirectory();
  const searchDir = options?.searchDir;
  const filter = options?.filter ?? 'production';
  const noCache = options?.noCache ?? false;

  // Disk cache keyed by target directory content hash.
  // Invalidation: any file content change in the target directory.
  // External consumer changes require --no-cache to force refresh.
  if (isDirectory) {
    const filePaths = getFilesInDirectory(absolute, filter);
    const cacheToolName = `ast-imports-graph${searchDir ? `-${path.basename(searchDir)}` : ''}`;

    return cachedDirectory<DependencyGraph>(
      cacheToolName,
      absolute,
      filePaths,
      () => computeDependencyGraph(absolute, true, searchDir, filter),
      { noCache },
    );
  }

  const filePaths = [absolute];
  const cacheToolName = `ast-imports-graph-file${searchDir ? `-${path.basename(searchDir)}` : ''}`;

  return cachedDirectory<DependencyGraph>(
    cacheToolName,
    path.dirname(absolute),
    filePaths,
    () => computeDependencyGraph(absolute, false, searchDir, filter),
    { noCache },
  );
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
        '  --no-cache    Bypass disk cache and recompute\n' +
        '  --test-files  Scan test files instead of production files\n' +
        '  --kind        Filter observations to a specific kind\n' +
        '  --count       Output observation kind counts instead of full data\n' +
        '  --consumers   Find all files that import the given file (reverse lookup)\n' +
        '  --symbol      Filter STATIC_IMPORT to files importing a specific named export\n' +
        '                e.g., --symbol filterOutAdminUids shows only files that import that symbol\n',
    );
    process.exit(0);
  }

  // --consumers mode: reverse lookup
  if (args.options.consumers) {
    const targetPath = args.options.consumers;
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const [targetFile] = extractFileNodes([absolute]);
    const candidatePaths = findConsumerFiles(targetFile.path);
    const candidateNodes = extractFileNodes(candidatePaths);

    const allFilesMap = new Map<string, FileNode>();
    allFilesMap.set(targetFile.path, targetFile);
    for (const node of candidateNodes) {
      allFilesMap.set(node.path, node);
    }

    const consumers = findConsumersForFile(targetFile, undefined, allFilesMap);
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

    allGraphs.push(
      buildDependencyGraph(targetPath, {
        filter: testFiles ? 'test' : 'production',
        noCache: args.flags.has('no-cache'),
      }),
    );
  }

  // --symbol mode
  if (args.options.symbol) {
    const symbol = args.options.symbol;
    const matchingFiles: { file: string; source: string; line: number; specifiers: string[] }[] = [];

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

    const output = { symbol, consumers: matchingFiles.length, files: matchingFiles };
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
