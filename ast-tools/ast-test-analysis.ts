import { type SourceFile, type CallExpression, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { truncateText } from './shared';
import { astConfig } from './ast-config';
import type {
  TestAnalysis,
  MockInfo,
  AssertionInfo,
  TestObservation,
  TestObservationKind,
  TestObservationEvidence,
} from './types';

// ---------------------------------------------------------------------------
// Constants (from astConfig)
// ---------------------------------------------------------------------------

const TEST_FILE_EXTENSIONS = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTestFile(filePath: string): boolean {
  return TEST_FILE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function isTestHelperPath(source: string): boolean {
  return astConfig.testing.testHelperPathPatterns.some(pattern => source.includes(pattern));
}

// ---------------------------------------------------------------------------
// Module resolution (adapted from ast-imports patterns)
// ---------------------------------------------------------------------------

function resolveViaProject(importSource: string, importingFilePath: string): string | null {
  const project = getProject();
  const sf = project.getSourceFile(importingFilePath);
  if (!sf) return null;

  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }
  return null;
}

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx'];

function resolveViaFilesystem(importSource: string, importingFilePath: string): string | null {
  const dir = path.dirname(importingFilePath);
  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = path.resolve(dir, importSource + ext);
    if (fs.existsSync(candidate)) return candidate;
  }
  const exact = path.resolve(dir, importSource);
  if (fs.existsSync(exact)) return exact;
  return null;
}

function resolveModulePath(importSource: string, importingFilePath: string): string | null {
  if (!importSource.startsWith('.') && !importSource.startsWith('@/')) return null;

  const projectResolved = resolveViaProject(importSource, importingFilePath);
  if (projectResolved) return projectResolved;

  if (importSource.startsWith('.')) return resolveViaFilesystem(importSource, importingFilePath);

  return null;
}

function isPackageImport(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('@/') && !source.startsWith('/');
}

// ---------------------------------------------------------------------------
// Subject detection
// ---------------------------------------------------------------------------

type SubjectResult = { subjectPath: string; subjectExists: boolean };

function resolveImportToSubject(source: string, filePath: string): SubjectResult {
  const resolved = resolveModulePath(source, filePath);
  if (resolved) return { subjectPath: path.relative(PROJECT_ROOT, resolved), subjectExists: true };
  return { subjectPath: source, subjectExists: false };
}

function isSkippableImport(source: string): boolean {
  return isTestHelperPath(source) || (isPackageImport(source) && !source.startsWith('@/'));
}

function matchesByBasename(source: string, baseNameWithoutExt: string): boolean {
  const sourceBasename = path.basename(source);
  return (
    sourceBasename === baseNameWithoutExt ||
    sourceBasename === `${baseNameWithoutExt}.ts` ||
    sourceBasename === `${baseNameWithoutExt}.tsx`
  );
}

function findSubjectByName(
  imports: ReturnType<SourceFile['getImportDeclarations']>,
  filePath: string,
  baseNameWithoutExt: string,
): SubjectResult | null {
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();
    if (isSkippableImport(source)) continue;
    if (matchesByBasename(source, baseNameWithoutExt)) return resolveImportToSubject(source, filePath);
  }
  return null;
}

function findSubjectByFirstRelativeImport(
  imports: ReturnType<SourceFile['getImportDeclarations']>,
  filePath: string,
): SubjectResult | null {
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();
    if (isTestHelperPath(source)) continue;
    if (decl.isTypeOnly()) continue;
    if (!source.startsWith('.') && !source.startsWith('@/')) continue;

    const resolved = resolveModulePath(source, filePath);
    if (resolved) {
      if (isTestFile(resolved)) continue;
      return { subjectPath: path.relative(PROJECT_ROOT, resolved), subjectExists: true };
    }
    return { subjectPath: source, subjectExists: false };
  }
  return null;
}

function stripTestExtension(fileName: string): string {
  for (const ext of ['.spec.tsx', '.spec.ts', '.test.tsx', '.test.ts']) {
    if (fileName.endsWith(ext)) return fileName.slice(0, -ext.length);
  }
  return fileName;
}

function detectSubject(sf: SourceFile, filePath: string): SubjectResult {
  const imports = sf.getImportDeclarations();
  const testFileName = path.basename(filePath);
  const baseNameWithoutExt = stripTestExtension(testFileName);

  return (
    findSubjectByName(imports, filePath, baseNameWithoutExt) ??
    findSubjectByFirstRelativeImport(imports, filePath) ?? { subjectPath: '', subjectExists: false }
  );
}

// ---------------------------------------------------------------------------
// Mock extraction (observation-only, no classification)
// ---------------------------------------------------------------------------

function getExportedFunctionNames(sf: SourceFile): string[] {
  const names: string[] = [];
  const exportedMap = sf.getExportedDeclarations();
  for (const [name] of exportedMap) {
    names.push(name);
  }
  return names;
}

function extractMockReturnShape(node: Node): string {
  // vi.mock(path) with no factory
  if (Node.isCallExpression(node)) {
    const args = node.getArguments();
    if (args.length < 2) return 'auto-mocked';

    const factory = args[1];
    const factoryText = factory.getText();

    if (factoryText.length > 200) return truncateText(factoryText, 200);
    return factoryText;
  }
  return 'unknown';
}

function collectViMock(node: CallExpression, filePath: string): MockInfo | null {
  const args = node.getArguments();
  if (args.length === 0) return null;

  const firstArg = args[0];
  if (!Node.isStringLiteral(firstArg)) return null;

  const target = firstArg.getLiteralValue();
  const resolved = resolveModulePath(target, filePath);
  const resolvedPath = resolved ? path.relative(PROJECT_ROOT, resolved) : target;
  const returnShape = extractMockReturnShape(node);

  return { target, resolvedPath, line: node.getStartLineNumber(), returnShape };
}

function collectViSpyOn(node: CallExpression): MockInfo | null {
  const args = node.getArguments();
  if (args.length < 2) return null;

  const spyTarget = args[0].getText();

  return {
    target: `${spyTarget}.${Node.isStringLiteral(args[1]) ? args[1].getLiteralValue() : args[1].getText()}`,
    resolvedPath: spyTarget,
    line: node.getStartLineNumber(),
    returnShape: 'spy',
  };
}

function extractMocks(sf: SourceFile, filePath: string): MockInfo[] {
  const mocks: MockInfo[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const objText = expr.getExpression().getText();
    if (objText !== 'vi') return;

    const methodName = expr.getName();

    if (methodName === 'mock') {
      const mock = collectViMock(node, filePath);
      if (mock) mocks.push(mock);
    } else if (methodName === 'spyOn') {
      const mock = collectViSpyOn(node);
      if (mock) mocks.push(mock);
    }
  });

  return mocks;
}

// ---------------------------------------------------------------------------
// Assertion extraction (observation-only, no classification)
// ---------------------------------------------------------------------------

/**
 * Walk down a chain like expect(x).not.toBe(y) to find the expect() call
 * at the bottom. Walks only downward (into child expressions), never up
 * to parent nodes, avoiding infinite recursion.
 */
function findExpectInChain(node: Node): CallExpression | null {
  // Pattern: expect(x).toBe(y) -- node is the toBe() CallExpression
  // expr chain: CallExpression -> PropertyAccess -> CallExpression(expect)
  //
  // Pattern: expect(x).not.toBe(y)
  // expr chain: CallExpression -> PropertyAccess -> PropertyAccess -> CallExpression(expect)
  let current: Node | undefined = node;

  for (let depth = 0; depth < 10; depth++) {
    if (!current) return null;

    if (Node.isCallExpression(current)) {
      const expr = current.getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'expect') {
        return current;
      }
      // Descend into the expression of the call
      current = expr;
      continue;
    }

    if (Node.isPropertyAccessExpression(current)) {
      // Descend into the expression before the dot
      current = current.getExpression();
      continue;
    }

    break;
  }

  return null;
}

function extractAssertions(sf: SourceFile): AssertionInfo[] {
  const assertions: AssertionInfo[] = [];
  const seen = new Set<number>();

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();

    // Look for the outermost matcher call: expect(...).toBe(...), expect(...).not.toBe(...)
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();

    // Check if this is a matcher (starts with 'to' or is 'resolves'/'rejects')
    if (!methodName.startsWith('to') && methodName !== 'resolves' && methodName !== 'rejects') return;

    // Find the expect() call by walking down the chain
    const expectCall = findExpectInChain(node);
    if (!expectCall) return;

    const line = node.getStartLineNumber();
    if (seen.has(line)) return;
    seen.add(line);

    const text = truncateText(node.getText(), 120);
    assertions.push({ line, text });
  });

  return assertions;
}

// ---------------------------------------------------------------------------
// Cleanup analysis
// ---------------------------------------------------------------------------

interface CleanupInfo {
  hasAfterEach: boolean;
  restoresMocks: boolean;
  restoresTimers: boolean;
  clearsStorage: boolean;
}

function scanAfterEachBodies(sf: SourceFile): Pick<CleanupInfo, 'restoresMocks' | 'restoresTimers' | 'clearsStorage'> {
  let restoresMocks = false;
  let restoresTimers = false;
  let clearsStorage = false;

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== 'afterEach') return;

    const args = node.getArguments();
    if (args.length === 0) return;

    const callbackText = args[0].getText();
    if (astConfig.testing.mockRestorePatterns.some(p => callbackText.includes(p))) restoresMocks = true;
    if (callbackText.includes('useRealTimers')) restoresTimers = true;
    if (astConfig.testing.storageClearPatterns.some(p => callbackText.includes(p))) clearsStorage = true;
  });

  return { restoresMocks, restoresTimers, clearsStorage };
}

function analyzeCleanup(sf: SourceFile): CleanupInfo {
  const fullText = sf.getFullText();
  const hasAfterEach = fullText.includes('afterEach(') || fullText.includes('afterEach (');

  const bodyResults = hasAfterEach
    ? scanAfterEachBodies(sf)
    : { restoresMocks: false, restoresTimers: false, clearsStorage: false };

  const usesTimers = fullText.includes('useFakeTimers');
  if (!usesTimers) bodyResults.restoresTimers = false;

  return { hasAfterEach, ...bodyResults };
}

// ---------------------------------------------------------------------------
// Data sourcing analysis
// ---------------------------------------------------------------------------

interface DataSourcingInfo {
  usesFixtureSystem: boolean;
  usesSharedMutableConstants: boolean;
  asAnyCount: number;
}

function isFixtureImport(source: string): boolean {
  return astConfig.testing.fixtureImportPatterns.some(
    pattern => source.includes(pattern) || source === pattern || source.startsWith(pattern + '/'),
  );
}

function isSharedMutableImport(source: string): boolean {
  return isTestFile(source) || astConfig.testing.sharedMutablePatterns.some(pattern => source.includes(pattern));
}

function scanDataImports(sf: SourceFile): Pick<DataSourcingInfo, 'usesFixtureSystem' | 'usesSharedMutableConstants'> {
  let usesFixtureSystem = false;
  let usesSharedMutableConstants = false;

  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    if (isFixtureImport(source)) usesFixtureSystem = true;
    if (isSharedMutableImport(source)) usesSharedMutableConstants = true;
  }

  return { usesFixtureSystem, usesSharedMutableConstants };
}

function countAsAnyCasts(sf: SourceFile): number {
  let count = 0;
  sf.forEachDescendant(node => {
    if (Node.isAsExpression(node)) {
      const typeNode = node.getTypeNode();
      if (typeNode && typeNode.getText() === 'any') count++;
    }
  });
  return count;
}

function analyzeDataSourcing(sf: SourceFile): DataSourcingInfo {
  const imports = scanDataImports(sf);
  const asAnyCount = countAsAnyCasts(sf);
  return { ...imports, asAnyCount };
}

// ---------------------------------------------------------------------------
// Describe/test counting
// ---------------------------------------------------------------------------

function countBlocks(sf: SourceFile): { describeCount: number; testCount: number } {
  let describeCount = 0;
  let testCount = 0;

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();

    let name = '';
    if (Node.isIdentifier(expr)) {
      name = expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      // describe.each, test.each, it.each, etc.
      name = expr.getExpression().getText();
    }

    if (name === 'describe') describeCount++;
    if (name === 'it' || name === 'test') testCount++;
  });

  return { describeCount, testCount };
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

function createObservation(
  kind: TestObservationKind,
  file: string,
  line: number,
  column: number,
  evidence: TestObservationEvidence,
): TestObservation {
  return { kind, file, line, column, evidence };
}

function extractImportObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    const line = decl.getStartLineNumber();
    const specifiers = decl
      .getNamedImports()
      .map(ni => ni.getName())
      .concat(decl.getDefaultImport()?.getText() ?? [])
      .filter(Boolean);

    // Check for playwright imports
    if (
      astConfig.testing.playwrightSources.has(source) ||
      source.endsWith('/fixture') ||
      source.endsWith('../fixture')
    ) {
      observations.push(
        createObservation('PLAYWRIGHT_IMPORT', filePath, line, 1, {
          importSource: source,
          specifiers,
        }),
      );
    }

    // Check for fixture imports
    if (isFixtureImport(source)) {
      observations.push(
        createObservation('FIXTURE_IMPORT', filePath, line, 1, {
          fixtureSource: source,
          importSource: source,
          specifiers,
        }),
      );
    }

    // Check for test helper imports
    if (isTestHelperPath(source)) {
      observations.push(
        createObservation('TEST_HELPER_IMPORT', filePath, line, 1, {
          importSource: source,
          specifiers,
        }),
      );
    }

    // Check for shared mutable imports
    if (isSharedMutableImport(source)) {
      observations.push(
        createObservation('SHARED_MUTABLE_IMPORT', filePath, line, 1, {
          importSource: source,
          specifiers,
        }),
      );
    }
  }

  return observations;
}

function extractMockObservations(sf: SourceFile, filePath: string, mocks: MockInfo[]): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const objText = expr.getExpression().getText();
    if (objText !== 'vi') return;

    const methodName = expr.getName();
    const line = node.getStartLineNumber();
    const column = node.getStartLineNumber();

    if (methodName === 'mock') {
      const args = node.getArguments();
      if (args.length === 0) return;

      const firstArg = args[0];
      if (!Node.isStringLiteral(firstArg)) return;

      const target = firstArg.getLiteralValue();
      const returnShapeText =
        args.length >= 2 ? truncateText(args[1].getText(), astConfig.truncation.mockFactoryMaxLength) : 'auto-mocked';

      observations.push(
        createObservation('MOCK_DECLARATION', filePath, line, column, {
          target,
          returnShapeText,
        }),
      );

      // Find the corresponding MockInfo to get the resolved path
      const mockInfo = mocks.find(m => m.target === target && m.line === line);
      if (mockInfo && mockInfo.resolvedPath !== target) {
        // Try to get export names from the resolved file
        const resolved = resolveModulePath(target, filePath);
        if (resolved) {
          try {
            const resolvedSf = getSourceFile(resolved);
            const exportNames = getExportedFunctionNames(resolvedSf);
            const fileExtension = path.extname(resolved);
            observations.push(
              createObservation('MOCK_TARGET_RESOLVED', filePath, line, column, {
                target,
                resolvedPath: mockInfo.resolvedPath,
                exportNames,
                fileExtension,
              }),
            );
          } catch {
            // Could not read resolved file, skip MOCK_TARGET_RESOLVED observation
          }
        }
      }
    } else if (methodName === 'spyOn') {
      const args = node.getArguments();
      if (args.length < 2) return;

      const spyTarget = args[0].getText();
      const spyMethod = Node.isStringLiteral(args[1]) ? args[1].getLiteralValue() : args[1].getText();

      observations.push(
        createObservation('SPY_DECLARATION', filePath, line, column, {
          spyTarget,
          spyMethod,
        }),
      );
    }
  });

  return observations;
}

function extractAssertionObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];
  const seen = new Set<number>();

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();
    if (!methodName.startsWith('to') && methodName !== 'resolves' && methodName !== 'rejects') return;

    const expectCall = findExpectInChain(node);
    if (!expectCall) return;

    const line = node.getStartLineNumber();
    if (seen.has(line)) return;
    seen.add(line);

    const expectArgs = expectCall.getArguments();
    const expectArgText = expectArgs.length > 0 ? expectArgs[0].getText() : '';

    observations.push(
      createObservation('ASSERTION_CALL', filePath, line, node.getStart(), {
        matcherName: methodName,
        expectArgText: truncateText(expectArgText, astConfig.truncation.assertionMaxLength),
        isScreenQuery: expectArgText.includes('screen.'),
        isResultCurrent: expectArgText.includes('result.current'),
      }),
    );
  });

  return observations;
}

function extractRenderObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;

    const name = expr.getText();
    const line = node.getStartLineNumber();

    if (name === 'render' || name === 'renderHook') {
      const fullText = node.getText();
      observations.push(
        createObservation('RENDER_CALL', filePath, line, node.getStart(), {
          isRenderHook: name === 'renderHook',
          hasWrapper: fullText.includes('wrapper'),
        }),
      );
    }
  });

  return observations;
}

function extractProviderObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];
  const fullText = sf.getFullText();

  for (const signal of astConfig.testing.providerSignals) {
    // Find all occurrences of the signal in the file
    let searchPos = 0;
    while (true) {
      const idx = fullText.indexOf(signal, searchPos);
      if (idx === -1) break;
      searchPos = idx + 1;

      // Get line number from position
      const textBefore = fullText.substring(0, idx);
      const line = textBefore.split('\n').length;

      observations.push(
        createObservation('PROVIDER_WRAPPER', filePath, line, 1, {
          providerName: signal,
        }),
      );
      break; // Only record once per signal type
    }
  }

  return observations;
}

function extractCleanupObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;

    const name = expr.getText();
    const line = node.getStartLineNumber();

    if (name === 'afterEach') {
      observations.push(createObservation('AFTER_EACH_BLOCK', filePath, line, node.getStart(), {}));

      // Check the callback body for cleanup patterns
      const args = node.getArguments();
      if (args.length > 0) {
        const callbackText = args[0].getText();

        for (const pattern of astConfig.testing.mockRestorePatterns) {
          if (callbackText.includes(pattern)) {
            observations.push(
              createObservation('CLEANUP_CALL', filePath, line, node.getStart(), {
                cleanupType: pattern,
              }),
            );
          }
        }

        for (const pattern of astConfig.testing.storageClearPatterns) {
          if (callbackText.includes(pattern)) {
            observations.push(
              createObservation('CLEANUP_CALL', filePath, line, node.getStart(), {
                cleanupType: pattern,
              }),
            );
          }
        }

        if (callbackText.includes('useRealTimers')) {
          observations.push(
            createObservation('CLEANUP_CALL', filePath, line, node.getStart(), {
              cleanupType: 'useRealTimers',
            }),
          );
        }
      }
    }
  });

  return observations;
}

function extractBlockObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    const line = node.getStartLineNumber();

    let name = '';
    if (Node.isIdentifier(expr)) {
      name = expr.getText();
    } else if (Node.isPropertyAccessExpression(expr)) {
      name = expr.getExpression().getText();
    }

    if (name === 'describe') {
      const args = node.getArguments();
      const describeName = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;
      observations.push(
        createObservation('DESCRIBE_BLOCK', filePath, line, node.getStart(), {
          describeName,
        }),
      );
    }

    if (name === 'it' || name === 'test') {
      const args = node.getArguments();
      const testName = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;
      observations.push(
        createObservation('TEST_BLOCK', filePath, line, node.getStart(), {
          testName,
        }),
      );
    }
  });

  return observations;
}

export function extractTestObservations(sf: SourceFile, filePath: string, mocks: MockInfo[]): TestObservation[] {
  const relativePath = path.relative(PROJECT_ROOT, filePath);

  return [
    ...extractImportObservations(sf, relativePath),
    ...extractMockObservations(sf, relativePath, mocks),
    ...extractAssertionObservations(sf, relativePath),
    ...extractRenderObservations(sf, relativePath),
    ...extractProviderObservations(sf, relativePath),
    ...extractCleanupObservations(sf, relativePath),
    ...extractBlockObservations(sf, relativePath),
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function analyzeTestFile(filePath: string): TestAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const { subjectPath, subjectExists } = detectSubject(sf, absolute);
  const isOrphaned = !subjectExists && subjectPath !== '';

  const mocks = extractMocks(sf, absolute);
  const assertions = extractAssertions(sf);
  const cleanup = analyzeCleanup(sf);
  const dataSourcing = analyzeDataSourcing(sf);
  const { describeCount, testCount } = countBlocks(sf);
  const observations = extractTestObservations(sf, absolute, mocks);

  return {
    filePath: relativePath,
    subjectPath,
    subjectExists,
    isOrphaned,
    describeCount,
    testCount,
    mocks,
    assertions,
    cleanup,
    dataSourcing,
    observations,
  };
}

export function analyzeTestDirectory(dirPath: string): TestAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const testFiles = getTestFilesInDirectory(absolute);

  const results: TestAnalysis[] = [];
  for (const fp of testFiles) {
    try {
      results.push(analyzeTestFile(fp));
    } catch (error) {
      console.error(
        `[ast-test-analysis] skipping unparseable file ${fp}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  return results;
}

function getTestFilesInDirectory(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
      results.push(...getTestFilesInDirectory(fullPath));
    } else if (entry.isFile() && isTestFile(entry.name)) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-test-analysis.ts <path...> [--pretty]\n' +
        '\n' +
        'Analyze test file patterns: mocks, assertions, strategy, cleanup.\n' +
        '\n' +
        '  <path...>  One or more .spec.ts/.test.ts files or directories\n' +
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
    const results = analyzeTestDirectory(targetPath);
    output(results, args.pretty);
  } else {
    const result = analyzeTestFile(targetPath);
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-test-analysis.ts') || process.argv[1].endsWith('ast-test-analysis'));

if (isDirectRun) {
  main();
}
