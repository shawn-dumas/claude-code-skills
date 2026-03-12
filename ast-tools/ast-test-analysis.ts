import { type SourceFile, type CallExpression, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { truncateText } from './shared';
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
// Mock classification
// ---------------------------------------------------------------------------

function classifyUnresolvedTarget(target: string): MockClassification {
  if (target.includes('firebase') || target.includes('supabase')) return 'BOUNDARY';
  if (target.startsWith('.') || target.startsWith('@/')) return classifyByPath(target);
  return 'THIRD_PARTY';
}

function classifyResolvedFile(resolved: string, relativePath: string, subjectDomainDir: string): MockClassification {
  const resolvedSf = getSourceFile(resolved);
  const exportedNames = getExportedFunctionNames(resolvedSf);

  const hasHooks = exportedNames.some(
    name => name.startsWith('use') && name.length > 3 && name[3] === name[3].toUpperCase(),
  );
  if (hasHooks) {
    if (subjectDomainDir && isDifferentDomain(relativePath, subjectDomainDir)) {
      return 'DOMAIN_BOUNDARY';
    }
    return 'OWN_HOOK';
  }

  const hasComponents = exportedNames.some(name => name.length > 0 && name[0] >= 'A' && name[0] <= 'Z');
  if (hasComponents && resolved.endsWith('.tsx')) return 'OWN_COMPONENT';

  return 'OWN_UTILITY';
}

function classifyMockTarget(target: string, filePath: string, subjectDomainDir: string): MockClassification {
  if (BOUNDARY_PACKAGES.has(target)) return 'BOUNDARY';
  if (BOUNDARY_FUNCTION_NAMES.has(target)) return 'BOUNDARY';
  if (isPackageImport(target)) return 'THIRD_PARTY';

  const resolved = resolveModulePath(target, filePath);
  if (!resolved) return classifyUnresolvedTarget(target);

  const relativePath = path.relative(PROJECT_ROOT, resolved);
  if (isBoundaryByPath(relativePath)) return 'BOUNDARY';

  try {
    return classifyResolvedFile(resolved, relativePath, subjectDomainDir);
  } catch (error) {
    console.error(
      `[ast-test-analysis] classifyMockTarget: could not resolve ${target}: ${error instanceof Error ? error.message : error}`,
    );
    return classifyByPath(target);
  }
}

function classifyByPath(target: string): MockClassification {
  if (target.includes('/hooks/') || target.includes('use')) return 'OWN_HOOK';
  if (
    target.split('/').some(seg => seg.length > 0 && seg[0] >= 'A' && seg[0] <= 'Z') &&
    (target.endsWith('.tsx') || !target.includes('.'))
  )
    return 'OWN_COMPONENT';
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

function collectViMock(node: CallExpression, filePath: string, subjectDomainDir: string): MockInfo | null {
  const args = node.getArguments();
  if (args.length === 0) return null;

  const firstArg = args[0];
  if (!Node.isStringLiteral(firstArg)) return null;

  const target = firstArg.getLiteralValue();
  const classification = classifyMockTarget(target, filePath, subjectDomainDir);
  const resolved = resolveModulePath(target, filePath);
  const resolvedPath = resolved ? path.relative(PROJECT_ROOT, resolved) : target;
  const returnShape = extractMockReturnShape(node);

  return { target, resolvedPath, classification, line: node.getStartLineNumber(), returnShape };
}

function classifySpyTarget(
  sf: SourceFile,
  spyTarget: string,
  filePath: string,
  subjectDomainDir: string,
): MockClassification {
  if (BOUNDARY_GLOBALS.has(spyTarget)) return 'BOUNDARY';

  for (const imp of sf.getImportDeclarations()) {
    const ns = imp.getNamespaceImport();
    if (ns && ns.getText() === spyTarget) {
      return classifyMockTarget(imp.getModuleSpecifierValue(), filePath, subjectDomainDir);
    }
  }
  return 'OWN_UTILITY';
}

function collectViSpyOn(
  node: CallExpression,
  sf: SourceFile,
  filePath: string,
  subjectDomainDir: string,
): MockInfo | null {
  const args = node.getArguments();
  if (args.length < 2) return null;

  const spyTarget = args[0].getText();
  const classification = classifySpyTarget(sf, spyTarget, filePath, subjectDomainDir);

  return {
    target: `${spyTarget}.${Node.isStringLiteral(args[1]) ? args[1].getLiteralValue() : args[1].getText()}`,
    resolvedPath: spyTarget,
    classification,
    line: node.getStartLineNumber(),
    returnShape: 'spy',
  };
}

function extractMocks(sf: SourceFile, filePath: string, subjectDomainDir: string): MockInfo[] {
  const mocks: MockInfo[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const objText = expr.getExpression().getText();
    if (objText !== 'vi') return;

    const methodName = expr.getName();

    if (methodName === 'mock') {
      const mock = collectViMock(node, filePath, subjectDomainDir);
      if (mock) mocks.push(mock);
    } else if (methodName === 'spyOn') {
      const mock = collectViSpyOn(node, sf, filePath, subjectDomainDir);
      if (mock) mocks.push(mock);
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

const SNAPSHOT_MATCHERS = new Set(['toMatchSnapshot', 'toMatchInlineSnapshot']);

const CALLED_MATCHERS = new Set(['toHaveBeenCalled', 'toHaveBeenCalledWith', 'toHaveBeenCalledTimes']);

function classifyByExpectArg(
  expectArgText: string,
  matcherName: string | null,
): AssertionInfo['classification'] | null {
  if (expectArgText.includes('result.current')) return 'HOOK_RETURN';
  if (containsTestingLibraryQuery(expectArgText)) return 'USER_VISIBLE';
  if (matcherName && USER_VISIBLE_MATCHERS.has(matcherName)) return 'USER_VISIBLE';
  if (expectArgText.includes('screen.')) return 'USER_VISIBLE';
  return null;
}

function isAriaAttributeAssertion(outerCall: CallExpression, matcherName: string | null): boolean {
  if (matcherName !== 'toHaveAttribute') return false;
  const matcherArgs = [...outerCall.getArguments()];
  return matcherArgs.length > 0 && matcherArgs[0].getText().includes('aria-');
}

function classifyCalledMatcher(expectArgText: string, propCallbackNames: Set<string>): AssertionInfo['classification'] {
  if (propCallbackNames.has(expectArgText) || expectArgText.startsWith('props.') || expectArgText.startsWith('on')) {
    return 'CALLBACK_FIRED';
  }
  return 'IMPLEMENTATION_DETAIL';
}

function classifyExpectChain(
  outerCall: CallExpression,
  expectCall: CallExpression,
  propCallbackNames: Set<string>,
): AssertionInfo | null {
  const line = outerCall.getStartLineNumber();
  const text = truncateText(outerCall.getText(), 120);
  const matcherName = getMatcherName(outerCall);

  if (matcherName && SNAPSHOT_MATCHERS.has(matcherName)) {
    return { line, classification: 'LARGE_SNAPSHOT', text };
  }

  const expectArgs = expectCall.getArguments();
  if (expectArgs.length === 0) return null;

  const expectArgText = expectArgs[0].getText();

  const argClassification = classifyByExpectArg(expectArgText, matcherName);
  if (argClassification) return { line, classification: argClassification, text };

  if (isAriaAttributeAssertion(outerCall, matcherName)) {
    return { line, classification: 'USER_VISIBLE', text };
  }

  if (matcherName && CALLED_MATCHERS.has(matcherName)) {
    return { line, classification: classifyCalledMatcher(expectArgText, propCallbackNames), text };
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
              const initText = Node.isJsxExpression(init) ? (init.getExpression()?.getText() ?? '') : init.getText();
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

const PLAYWRIGHT_SOURCES = new Set(['@playwright/test']);

function hasPlaywrightImport(sf: SourceFile): boolean {
  return sf.getImportDeclarations().some(d => {
    const source = d.getModuleSpecifierValue();
    return PLAYWRIGHT_SOURCES.has(source) || source.endsWith('/fixture') || source.endsWith('../fixture');
  });
}

interface StrategySignals {
  hasRender: boolean;
  hasRenderHook: boolean;
  hasMsw: boolean;
  hasProviderWrapper: boolean;
}

function collectStrategySignals(fullText: string): StrategySignals {
  return {
    hasRender: fullText.includes('render(') || fullText.includes('render(<'),
    hasRenderHook: fullText.includes('renderHook(') || fullText.includes('renderHook<'),
    hasMsw: fullText.includes('server.use(') || fullText.includes('fetchMock'),
    hasProviderWrapper:
      fullText.includes('QueryClientProvider') ||
      fullText.includes('QueryClient(') ||
      fullText.includes('AuthProvider') ||
      fullText.includes('wrapper:') ||
      fullText.includes('renderWith'),
  };
}

function detectStrategy(sf: SourceFile): TestStrategy {
  const fullText = sf.getFullText();

  if (hasPlaywrightImport(sf)) return 'playwright';

  const signals = collectStrategySignals(fullText);
  if (signals.hasMsw) return 'integration-msw';

  if (signals.hasRender || signals.hasRenderHook) {
    if (signals.hasProviderWrapper) return 'integration-providers';
    if (hasPureFunctionCalls(sf) && signals.hasRender) return 'mixed';
    return 'unit-props';
  }

  return 'unit-pure';
}

// Names that are NOT pure function calls under test
const NON_PURE_NAMES = new Set([
  'render',
  'renderHook',
  'expect',
  'describe',
  'it',
  'test',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'vi',
  'jest',
  'screen',
  'within',
  'waitFor',
  'act',
  'cleanup',
  'fireEvent',
  'userEvent',
]);

function isInsideTestBlock(node: Node): boolean {
  let ancestor = node.getParent();
  while (ancestor) {
    if (Node.isCallExpression(ancestor)) {
      const ancestorExpr = ancestor.getExpression();
      if (Node.isIdentifier(ancestorExpr)) {
        const name = ancestorExpr.getText();
        if (name === 'it' || name === 'test') return true;
      }
    }
    ancestor = ancestor.getParent();
  }
  return false;
}

function hasPureFunctionCalls(sf: SourceFile): boolean {
  let found = false;

  sf.forEachDescendant(node => {
    if (found) return;
    if (!Node.isCallExpression(node)) return;
    if (!isInsideTestBlock(node)) return;

    const expr = node.getExpression();
    if (Node.isIdentifier(expr)) {
      const name = expr.getText();
      if (!NON_PURE_NAMES.has(name) && !name.startsWith('use')) found = true;
    }
  });

  return found;
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

const MOCK_RESTORE_PATTERNS = ['restoreAllMocks', 'clearAllMocks', 'resetAllMocks'];
const STORAGE_CLEAR_PATTERNS = ['localStorage.clear', 'sessionStorage.clear'];

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
    if (MOCK_RESTORE_PATTERNS.some(p => callbackText.includes(p))) restoresMocks = true;
    if (callbackText.includes('useRealTimers')) restoresTimers = true;
    if (STORAGE_CLEAR_PATTERNS.some(p => callbackText.includes(p))) clearsStorage = true;
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
  return source.includes('fixtures') || source === '@/fixtures' || source.startsWith('@/fixtures/');
}

function isSharedMutableImport(source: string): boolean {
  return isTestFile(source) || source.includes('__tests__/constants') || source.includes('test-constants');
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
