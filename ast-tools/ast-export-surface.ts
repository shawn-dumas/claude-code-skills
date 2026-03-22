/**
 * ast-export-surface: Extract the complete export surface from one or more files.
 *
 * Unlike ast-imports which builds a full dependency graph, this tool works on
 * isolated files -- it parses a single file and lists every export declaration
 * with its kind (function, const, type, interface, class, default, reexport).
 *
 * Critical for provenance audits: comparing what a deleted file exported on one
 * branch vs what exists on another, without requiring full project context.
 */

import { type SourceFile, type ExportedDeclarations, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory, type FileFilter } from './shared';
import { cached, getCacheStats } from './ast-cache';
import { writeGitFileToTemp, createVirtualProject } from './git-source';
import type {
  ExportInfo,
  ExportSurfaceObservation,
  ExportSurfaceObservationEvidence,
  ExportSurfaceAnalysis,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Declaration kind classification (matches ast-imports logic)
// ---------------------------------------------------------------------------

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

function classifyVariableInit(decl: Node): ExportInfo['kind'] {
  if (!Node.isVariableDeclaration(decl)) return 'const';
  const init = decl.getInitializer();
  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
    return 'function';
  }
  return 'const';
}

function classifyExportKind(name: string, declarations: ExportedDeclarations[]): ExportInfo['kind'] {
  if (name === 'default') return 'default';
  if (declarations.length === 0) return 'const';
  const decl = declarations[0];

  const matched = DECLARATION_KIND_CHECKS.find(check => check.guard(decl));
  if (matched) return matched.kind;

  if (Node.isVariableDeclaration(decl)) return classifyVariableInit(decl);

  return 'const';
}

// ---------------------------------------------------------------------------
// Export surface extraction (isolated, no import resolution)
// ---------------------------------------------------------------------------

interface RawExport {
  name: string;
  kind: ExportSurfaceObservationEvidence['exportKind'];
  isTypeOnly: boolean;
  line: number;
  source?: string;
}

function collectDeclaredExports(sf: SourceFile): RawExport[] {
  const exports: RawExport[] = [];
  for (const [name, declarations] of sf.getExportedDeclarations()) {
    const kind = classifyExportKind(name, declarations);
    const isTypeOnly = kind === 'type' || kind === 'interface';
    const firstDecl = declarations[0];
    const line = firstDecl ? firstDecl.getStartLineNumber() : 1;
    exports.push({ name, kind, isTypeOnly, line });
  }
  return exports;
}

function collectReexports(sf: SourceFile): RawExport[] {
  const exports: RawExport[] = [];

  for (const exportDecl of sf.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    const isTypeOnly = exportDecl.isTypeOnly();
    const line = exportDecl.getStartLineNumber();

    if (exportDecl.isNamespaceExport()) {
      exports.push({
        name: '*',
        kind: 'reexport',
        isTypeOnly,
        line,
        source: moduleSpecifier,
      });
    } else {
      for (const named of exportDecl.getNamedExports()) {
        const exportName = named.getAliasNode()?.getText() ?? named.getName();
        exports.push({
          name: exportName,
          kind: 'reexport',
          isTypeOnly: isTypeOnly || named.isTypeOnly(),
          line,
          source: moduleSpecifier,
        });
      }
    }
  }

  return exports;
}

function extractAllExports(sf: SourceFile): RawExport[] {
  const declared = collectDeclaredExports(sf);
  const reexports = collectReexports(sf);

  // Mark declared exports that are also re-exported (from a module specifier) as reexports.
  // Reexports take precedence -- if an export appears as both declared and re-exported,
  // the reexport version (with source) wins.
  const reexportNames = new Set(reexports.map(r => r.name));
  const result: RawExport[] = declared.filter(d => !reexportNames.has(d.name));
  result.push(...reexports);

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function toObservation(filePath: string, raw: RawExport): ExportSurfaceObservation {
  const evidence: ExportSurfaceObservationEvidence = {
    name: raw.name,
    exportKind: raw.kind,
    isTypeOnly: raw.isTypeOnly,
  };
  if (raw.source !== undefined) {
    evidence.source = raw.source;
  }
  return {
    kind: 'EXPORT_SURFACE' as const,
    file: filePath,
    line: raw.line,
    evidence,
  };
}

export function analyzeExportSurface(filePath: string): ExportSurfaceAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const rawExports = extractAllExports(sf);
  const observations = rawExports.map(raw => toObservation(relativePath, raw));

  return {
    filePath: relativePath,
    observations,
  };
}

export function analyzeExportSurfaceDirectory(
  dirPath: string,
  options: { noCache?: boolean; filter?: FileFilter } = {},
): ExportSurfaceAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const filePaths = getFilesInDirectory(absolute, options.filter ?? 'production');

  const results: ExportSurfaceAnalysis[] = [];
  for (const fp of filePaths) {
    const analysis = cached('ast-export-surface', fp, () => analyzeExportSurface(fp), options);
    results.push(analysis);
  }

  return results;
}

export function extractExportSurfaceObservations(
  analysis: ExportSurfaceAnalysis,
): ObservationResult<ExportSurfaceObservation> {
  return {
    filePath: analysis.filePath,
    observations: analysis.observations,
  };
}

// ---------------------------------------------------------------------------
// Git ref mode: parse a file from a git ref
// ---------------------------------------------------------------------------

function analyzeExportSurfaceFromGit(refAndPath: string): ExportSurfaceAnalysis {
  const colonIndex = refAndPath.indexOf(':');
  if (colonIndex === -1) {
    fatal('--from-git expects format <ref>:<path> (e.g., production:src/utils/foo.ts)');
  }

  const ref = refAndPath.substring(0, colonIndex);
  const filePath = refAndPath.substring(colonIndex + 1);

  const tmpPath = writeGitFileToTemp(ref, filePath);
  try {
    const project = createVirtualProject();
    const sf = project.addSourceFileAtPath(tmpPath);
    const rawExports = extractAllExports(sf);
    const observations = rawExports.map(raw => toObservation(filePath, raw));

    return {
      filePath,
      observations,
    };
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv, {
    namedOptions: ['--from-git'],
  });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-export-surface.ts <path...> [--pretty] [--no-cache] [--test-files] [--kind <kind>] [--count]\n' +
        '       npx tsx scripts/AST/ast-export-surface.ts --from-git <ref>:<path> [--pretty]\n' +
        '\n' +
        'Extract the complete export surface from one or more files.\n' +
        '\n' +
        '  <path...>          One or more .ts/.tsx files or directories to analyze\n' +
        '  --from-git <r:p>   Read file from git ref (e.g., production:src/utils/foo.ts)\n' +
        '  --pretty           Format JSON output with indentation\n' +
        '  --no-cache         Bypass cache and recompute\n' +
        '  --test-files       Scan test files instead of production files\n' +
        '  --kind             Filter observations to a specific kind\n' +
        '  --count            Output observation kind counts instead of full data\n',
    );
    process.exit(0);
  }

  // --from-git mode
  const fromGit = args.options['from-git'];
  if (fromGit) {
    const result = analyzeExportSurfaceFromGit(fromGit);
    outputFiltered(result, args.pretty, {
      kind: args.options.kind,
      count: args.flags.has('count'),
    });
    return;
  }

  const noCache = args.flags.has('no-cache');
  const testFiles = args.flags.has('test-files');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: ExportSurfaceAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(
        ...analyzeExportSurfaceDirectory(targetPath, { noCache, filter: testFiles ? 'test' : 'production' }),
      );
    } else {
      const result = cached('ast-export-surface', absolute, () => analyzeExportSurface(targetPath), { noCache });
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
  process.argv[1] &&
  (process.argv[1].endsWith('ast-export-surface.ts') || process.argv[1].endsWith('ast-export-surface'));

if (isDirectRun) {
  main();
}
