import { type SourceFile, type CallExpression, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import type { TestAnalysis, TestStrategy, MockClassification, MockInfo, AssertionInfo } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOUNDARY_PACKAGES = new Set([
  'next/router',
  'next/navigation',
  'posthog-js',
  'firebase',
  'firebase/auth',
  'firebase/app',
  'firebase/database',
  'firebase/firestore',
  'firebase/functions',
  'firebase/storage',
  'firebase-admin',
  'firebase-admin/auth',
  'fs',
  'crypto',
  'process',
]);

const BOUNDARY_GLOBALS = new Set([
  'window',
  'document',
  'console',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
]);

const BOUNDARY_FUNCTION_NAMES = new Set(['fetch', 'fetchApi', 'useFetchApi', 'localStorage', 'sessionStorage']);

const TEST_FILE_EXTENSIONS = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'];

const TESTING_LIBRARY_QUERIES = new Set([
  'getByText',
  'getByRole',
  'getByLabelText',
  'getByPlaceholderText',
  'getByDisplayValue',
  'getByAltText',
  'getByTitle',
  'getByTestId',
  'queryByText',
  'queryByRole',
  'queryByLabelText',
  'queryByPlaceholderText',
  'queryByDisplayValue',
  'queryByAltText',
  'queryByTitle',
  'queryByTestId',
  'findByText',
  'findByRole',
  'findByLabelText',
  'findByPlaceholderText',
  'findByDisplayValue',
  'findByAltText',
  'findByTitle',
  'findByTestId',
  'getAllByText',
  'getAllByRole',
  'getAllByLabelText',
  'getAllByTestId',
  'queryAllByText',
  'queryAllByRole',
  'queryAllByTestId',
  'findAllByText',
  'findAllByRole',
  'findAllByTestId',
]);

const USER_VISIBLE_MATCHERS = new Set([
  'toBeVisible',
  'toBeInTheDocument',
  'toHaveTextContent',
  'toBeDisabled',
  'toBeEnabled',
  'toHaveAccessibleName',
  'toHaveAccessibleDescription',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateText(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.substring(0, maxLen - 3) + '...';
}

function isTestFile(filePath: string): boolean {
  return TEST_FILE_EXTENSIONS.some(ext => filePath.endsWith(ext));
}

function isTestHelperPath(source: string): boolean {
  return (
    source.includes('__tests__/helpers') ||
    source.includes('test-utils') ||
    source.includes('test-helpers') ||
    source.includes('vitest') ||
    source.includes('@testing-library')
  );
}

// ---------------------------------------------------------------------------
// Module resolution (adapted from ast-imports patterns)
// ---------------------------------------------------------------------------

function resolveModulePath(importSource: string, importingFilePath: string): string | null {
  if (!importSource.startsWith('.') && !importSource.startsWith('@/')) {
    return null;
  }

  const project = getProject();
  const sf = project.getSourceFile(importingFilePath);
  if (!sf) return null;

  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() === importSource) {
      const resolved = decl.getModuleSpecifierSourceFile();
      if (resolved) return resolved.getFilePath();
    }
  }

  if (importSource.startsWith('.')) {
    const dir = path.dirname(importingFilePath);
    const extensions = ['.ts', '.tsx', '/index.ts', '/index.tsx'];
    for (const ext of extensions) {
      const candidate = path.resolve(dir, importSource + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
    const exact = path.resolve(dir, importSource);
    if (fs.existsSync(exact)) return exact;
  }

  return null;
}

function isPackageImport(source: string): boolean {
  return !source.startsWith('.') && !source.startsWith('@/') && !source.startsWith('/');
}

// ---------------------------------------------------------------------------
// Subject detection
// ---------------------------------------------------------------------------

function detectSubject(sf: SourceFile, filePath: string): { subjectPath: string; subjectExists: boolean } {
  const imports = sf.getImportDeclarations();
  const testFileName = path.basename(filePath);
  const baseNameWithoutExt = testFileName.replace(/\.spec\.tsx?$/, '').replace(/\.test\.tsx?$/, '');

  // First pass: look for an import whose source matches the test file name
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();

    if (isTestHelperPath(source)) continue;
    if (isPackageImport(source) && !source.startsWith('@/')) continue;

    const sourceBasename = path.basename(source);
    if (
      sourceBasename === baseNameWithoutExt ||
      sourceBasename === `${baseNameWithoutExt}.ts` ||
      sourceBasename === `${baseNameWithoutExt}.tsx`
    ) {
      const resolved = resolveModulePath(source, filePath);
      if (resolved) {
        return { subjectPath: path.relative(PROJECT_ROOT, resolved), subjectExists: true };
      }
      return { subjectPath: source, subjectExists: false };
    }
  }

  // Second pass: first non-test, non-package, non-helper relative import
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();

    if (isTestHelperPath(source)) continue;
    if (decl.isTypeOnly()) continue;

    if (source.startsWith('.') || source.startsWith('@/')) {
      const resolved = resolveModulePath(source, filePath);
      if (resolved) {
        if (isTestFile(resolved)) continue;
        return { subjectPath: path.relative(PROJECT_ROOT, resolved), subjectExists: true };
      }
      return { subjectPath: source, subjectExists: false };
    }
  }

  return { subjectPath: '', subjectExists: false };
}

// ---------------------------------------------------------------------------
// Mock classification
// ---------------------------------------------------------------------------

function classifyMockTarget(target: string, filePath: string, subjectDomainDir: string): MockClassification {
  if (BOUNDARY_PACKAGES.has(target)) return 'BOUNDARY';
  if (BOUNDARY_FUNCTION_NAMES.has(target)) return 'BOUNDARY';

  if (isPackageImport(target)) return 'THIRD_PARTY';

  const resolved = resolveModulePath(target, filePath);

  if (!resolved) {
    if (target.includes('firebase') || target.includes('supabase')) return 'BOUNDARY';
    if (target.startsWith('.') || target.startsWith('@/')) {
      return classifyByPath(target, subjectDomainDir);
    }
    return 'THIRD_PARTY';
  }

  const relativePath = path.relative(PROJECT_ROOT, resolved);

  if (isBoundaryByPath(relativePath)) return 'BOUNDARY';

  // Read the resolved file to classify its exports
  try {
    const resolvedSf = getSourceFile(resolved);
    const exportedNames = getExportedFunctionNames(resolvedSf);

    const hasHooks = exportedNames.some(
      name => name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase(),
    );
    if (hasHooks) {
      // Check domain boundary
      if (subjectDomainDir && isDifferentDomain(relativePath, subjectDomainDir)) {
        return 'DOMAIN_BOUNDARY';
      }
      return 'OWN_HOOK';
    }

    const hasComponents = exportedNames.some(name => /^[A-Z]/.test(name));
    if (hasComponents && resolved.endsWith('.tsx')) {
      return 'OWN_COMPONENT';
    }

    return 'OWN_UTILITY';
  } catch {
    return classifyByPath(target, subjectDomainDir);
  }
}

function classifyByPath(target: string, subjectDomainDir: string): MockClassification {
  if (target.includes('/hooks/') || target.includes('use')) return 'OWN_HOOK';
  if (/\/[A-Z][a-zA-Z]+/.test(target) && (target.endsWith('.tsx') || !target.includes('.'))) return 'OWN_COMPONENT';
  return 'OWN_UTILITY';
}

function isBoundaryByPath(relativePath: string): boolean {
  return (
    relativePath.includes('fetchApi') ||
    relativePath.includes('useFetchApi') ||
    relativePath.includes('firebase') ||
    relativePath.includes('typedStorage') ||
    relativePath.includes('posthog')
  );
}

function isDifferentDomain(targetPath: string, subjectDomainDir: string): boolean {
  if (!subjectDomainDir) return false;
  return !targetPath.startsWith(subjectDomainDir);
}

function getExportedFunctionNames(sf: SourceFile): string[] {
  const names: string[] = [];
  const exportedMap = sf.getExportedDeclarations();
  for (const [name] of exportedMap) {
    names.push(name);
  }
  return names;
}

function getDomainDir(filePath: string): string {
  // Extract the domain directory from the file path
  // e.g., src/ui/page_blocks/dashboard/team/... -> src/ui/page_blocks/dashboard/team
  const parts = filePath.split('/');
  const dashboardIdx = parts.indexOf('dashboard');
  if (dashboardIdx !== -1 && dashboardIdx + 1 < parts.length) {
    return parts.slice(0, dashboardIdx + 2).join('/');
  }

  const hooksIdx = parts.indexOf('hooks');
  if (hooksIdx !== -1 && hooksIdx + 1 < parts.length) {
    return parts.slice(0, hooksIdx + 2).join('/');
  }

  // Fallback: use the directory containing the file
  return path.dirname(filePath);
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

function extractMocks(sf: SourceFile, filePath: string, subjectDomainDir: string): MockInfo[] {
  const mocks: MockInfo[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();

    // vi.mock(path, factory?)
    if (Node.isPropertyAccessExpression(expr)) {
      const objText = expr.getExpression().getText();
      const methodName = expr.getName();

      if (objText === 'vi' && methodName === 'mock') {
        const args = node.getArguments();
        if (args.length === 0) return;

        const firstArg = args[0];
        if (!Node.isStringLiteral(firstArg)) return;

        const target = firstArg.getLiteralValue();
        const classification = classifyMockTarget(target, filePath, subjectDomainDir);
        const resolved = resolveModulePath(target, filePath);
        const resolvedPath = resolved ? path.relative(PROJECT_ROOT, resolved) : target;
        const returnShape = extractMockReturnShape(node);

        mocks.push({
          target,
          resolvedPath,
          classification,
          line: node.getStartLineNumber(),
          returnShape,
        });
      }

      // vi.spyOn(object, method)
      if (objText === 'vi' && methodName === 'spyOn') {
        const args = node.getArguments();
        if (args.length < 2) return;

        const spyTarget = args[0].getText();
        let classification: MockClassification = 'OWN_UTILITY';

        if (BOUNDARY_GLOBALS.has(spyTarget)) {
          classification = 'BOUNDARY';
        } else {
          // Check if the spy target is a module namespace import
          for (const imp of sf.getImportDeclarations()) {
            const ns = imp.getNamespaceImport();
            if (ns && ns.getText() === spyTarget) {
              const source = imp.getModuleSpecifierValue();
              classification = classifyMockTarget(source, filePath, subjectDomainDir);
              break;
            }
          }
        }

        mocks.push({
          target: `${spyTarget}.${args[1].getText().replace(/['"]/g, '')}`,
          resolvedPath: spyTarget,
          classification,
          line: node.getStartLineNumber(),
          returnShape: 'spy',
        });
      }
    }
  });

  return mocks;
}

// ---------------------------------------------------------------------------
// Assertion classification
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

function containsTestingLibraryQuery(text: string): boolean {
  for (const query of TESTING_LIBRARY_QUERIES) {
    if (text.includes(query)) return true;
  }
  return false;
}

function getMatcherName(node: CallExpression): string | null {
  const expr = node.getExpression();
  if (Node.isPropertyAccessExpression(expr)) {
    return expr.getName();
  }
  return null;
}

function classifyExpectChain(
  outerCall: CallExpression,
  expectCall: CallExpression,
  propCallbackNames: Set<string>,
): AssertionInfo | null {
  const line = outerCall.getStartLineNumber();
  const text = truncateText(outerCall.getText(), 120);

  // Determine the matcher name from the outermost call
  const matcherName = getMatcherName(outerCall);

  // Check for snapshot matchers
  if (matcherName === 'toMatchSnapshot' || matcherName === 'toMatchInlineSnapshot') {
    return { line, classification: 'LARGE_SNAPSHOT', text };
  }

  // Get the argument to expect()
  const expectArgs = expectCall.getArguments();
  if (expectArgs.length === 0) return null;

  const expectArgText = expectArgs[0].getText();

  // HOOK_RETURN: result.current.*
  if (expectArgText.includes('result.current')) {
    return { line, classification: 'HOOK_RETURN', text };
  }

  // USER_VISIBLE: testing-library query in expect argument
  if (containsTestingLibraryQuery(expectArgText)) {
    return { line, classification: 'USER_VISIBLE', text };
  }

  // USER_VISIBLE matchers (toBeVisible, toBeInTheDocument, etc.)
  if (matcherName && USER_VISIBLE_MATCHERS.has(matcherName)) {
    return { line, classification: 'USER_VISIBLE', text };
  }

  // Check for .toHaveAttribute('aria-*')
  if (matcherName === 'toHaveAttribute') {
    const matcherArgs = [...outerCall.getArguments()];
    if (matcherArgs.length > 0 && matcherArgs[0].getText().includes('aria-')) {
      return { line, classification: 'USER_VISIBLE', text };
    }
  }

  // CALLBACK_FIRED: mock function passed as prop callback
  if (
    matcherName === 'toHaveBeenCalled' ||
    matcherName === 'toHaveBeenCalledWith' ||
    matcherName === 'toHaveBeenCalledTimes'
  ) {
    if (propCallbackNames.has(expectArgText) || expectArgText.startsWith('props.') || expectArgText.startsWith('on')) {
      return { line, classification: 'CALLBACK_FIRED', text };
    }
    return { line, classification: 'IMPLEMENTATION_DETAIL', text };
  }

  // Default for screen queries in the argument
  if (expectArgText.includes('screen.')) {
    return { line, classification: 'USER_VISIBLE', text };
  }

  return null;
}

function extractAssertions(sf: SourceFile, propCallbackNames: Set<string>): AssertionInfo[] {
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

    const result = classifyExpectChain(node, expectCall, propCallbackNames);
    if (result) {
      assertions.push(result);
    }
  });

  return assertions;
}

// ---------------------------------------------------------------------------
// Prop callback detection
// ---------------------------------------------------------------------------

function detectPropCallbackNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;
    if (expr.getText() !== 'render') return;

    // Look at JSX props in the render() call
    const args = node.getArguments();
    for (const arg of args) {
      arg.forEachDescendant(child => {
        if (Node.isJsxAttribute(child)) {
          const nameNode = child.getNameNode();
          const name = nameNode.getText();
          if (name.startsWith('on') && name.length > 2) {
            const init = child.getInitializer();
            if (init) {
              const initText = init.getText().replace(/[{}]/g, '').trim();
              names.add(initText);
              names.add(name);
            }
          }
        }
      });
    }
  });

  return names;
}

// ---------------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------------

function detectStrategy(sf: SourceFile): TestStrategy {
  const fullText = sf.getFullText();

  // Playwright detection
  if (fullText.includes('@playwright/test') || fullText.includes('../fixture')) {
    const hasPlaywrightImport = sf.getImportDeclarations().some(d => {
      const source = d.getModuleSpecifierValue();
      return source === '@playwright/test' || source.endsWith('/fixture') || source.endsWith('../fixture');
    });
    if (hasPlaywrightImport) return 'playwright';
  }

  const hasRender = fullText.includes('render(') || fullText.includes('render(<');
  const hasRenderHook = fullText.includes('renderHook(') || fullText.includes('renderHook<');
  const hasMsw = fullText.includes('server.use(') || fullText.includes('fetchMock');

  if (hasMsw) return 'integration-msw';

  const hasProviderWrapper =
    fullText.includes('QueryClientProvider') ||
    fullText.includes('QueryClient(') ||
    fullText.includes('AuthProvider') ||
    fullText.includes('wrapper:') ||
    fullText.includes('renderWith');

  if (hasRender || hasRenderHook) {
    if (hasProviderWrapper) return 'integration-providers';

    // Check if there are also pure function calls (mixed strategy)
    const hasPureCalls = hasPureFunctionCalls(sf);
    if (hasPureCalls && hasRender) return 'mixed';

    return 'unit-props';
  }

  return 'unit-pure';
}

function hasPureFunctionCalls(sf: SourceFile): boolean {
  // Heuristic: check if there are describe blocks with only direct function
  // calls and no render/renderHook
  let pureCount = 0;
  let renderCount = 0;

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      if (name === 'render' || name === 'renderHook') renderCount++;
    }
  });

  return renderCount === 0 && pureCount === 0;
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

function analyzeCleanup(sf: SourceFile): CleanupInfo {
  const fullText = sf.getFullText();
  const hasAfterEach = fullText.includes('afterEach(') || fullText.includes('afterEach (');

  // Check what's inside afterEach blocks
  let restoresMocks = false;
  let restoresTimers = false;
  let clearsStorage = false;

  if (hasAfterEach) {
    sf.forEachDescendant(node => {
      if (!Node.isCallExpression(node)) return;
      const expr = node.getExpression();
      if (!Node.isIdentifier(expr)) return;
      if (expr.getText() !== 'afterEach') return;

      const args = node.getArguments();
      if (args.length === 0) return;

      const callbackText = args[0].getText();
      if (
        callbackText.includes('restoreAllMocks') ||
        callbackText.includes('clearAllMocks') ||
        callbackText.includes('resetAllMocks')
      ) {
        restoresMocks = true;
      }
      if (callbackText.includes('useRealTimers')) {
        restoresTimers = true;
      }
      if (callbackText.includes('localStorage.clear') || callbackText.includes('sessionStorage.clear')) {
        clearsStorage = true;
      }
    });
  }

  // Check if timers are used at all
  const usesTimers = fullText.includes('useFakeTimers');
  if (!usesTimers) {
    restoresTimers = false; // Not applicable
  }

  return { hasAfterEach, restoresMocks, restoresTimers, clearsStorage };
}

// ---------------------------------------------------------------------------
// Data sourcing analysis
// ---------------------------------------------------------------------------

interface DataSourcingInfo {
  usesFixtureSystem: boolean;
  usesSharedMutableConstants: boolean;
  asAnyCount: number;
}

function analyzeDataSourcing(sf: SourceFile): DataSourcingInfo {
  let usesFixtureSystem = false;
  let usesSharedMutableConstants = false;
  let asAnyCount = 0;

  // Check imports for fixture system
  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    if (source.includes('fixtures') || source === '@/fixtures' || source.startsWith('@/fixtures/')) {
      usesFixtureSystem = true;
    }

    // Check for shared mutable constants (imports from other test files or non-fixture shared modules)
    if (isTestFile(source) || source.includes('__tests__/constants') || source.includes('test-constants')) {
      usesSharedMutableConstants = true;
    }
  }

  // Count `as any` occurrences using AST
  sf.forEachDescendant(node => {
    if (Node.isAsExpression(node)) {
      const typeNode = node.getTypeNode();
      if (typeNode && typeNode.getText() === 'any') {
        asAnyCount++;
      }
    }
  });

  return { usesFixtureSystem, usesSharedMutableConstants, asAnyCount };
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
// Public API
// ---------------------------------------------------------------------------

export function analyzeTestFile(filePath: string): TestAnalysis {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = getSourceFile(absolute);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const { subjectPath, subjectExists } = detectSubject(sf, absolute);
  const isOrphaned = !subjectExists && subjectPath !== '';
  const subjectDomainDir = subjectPath ? getDomainDir(subjectPath) : '';

  const mocks = extractMocks(sf, absolute, subjectDomainDir);
  const propCallbackNames = detectPropCallbackNames(sf);
  const assertions = extractAssertions(sf, propCallbackNames);
  const strategy = detectStrategy(sf);
  const cleanup = analyzeCleanup(sf);
  const dataSourcing = analyzeDataSourcing(sf);
  const { describeCount, testCount } = countBlocks(sf);

  return {
    filePath: relativePath,
    subjectPath,
    subjectExists,
    isOrphaned,
    strategy,
    describeCount,
    testCount,
    mocks,
    assertions,
    cleanup,
    dataSourcing,
  };
}

export function analyzeTestDirectory(dirPath: string): TestAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const testFiles = getTestFilesInDirectory(absolute);

  const results: TestAnalysis[] = [];
  for (const fp of testFiles) {
    try {
      results.push(analyzeTestFile(fp));
    } catch {
      // Skip files that cannot be parsed
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
