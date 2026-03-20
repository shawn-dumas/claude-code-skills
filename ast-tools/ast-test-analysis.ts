// AUTHORITY CONTRACT: All observations with authoritative=true MUST be
// reported as findings by consuming agents. Agents do NOT filter these.
// Priority assignment comes from PRIORITY_RULES in ast-config.ts.

import { type SourceFile, type CallExpression, Node, SyntaxKind } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getProject, getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { truncateText, findExpectInChain, resolveCallName, resolvePrintfTemplate, getFilesInDirectory } from './shared';
import { cached, getCacheStats } from './ast-cache';
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

/**
 * Find the raw import specifier string for the subject module.
 * Used to exclude subject functions from helper delegation tracking.
 * Mirrors the logic in detectSubject: name-based match first,
 * then first-relative-import fallback.
 */
function detectSubjectImportSource(sf: SourceFile, filePath: string, subjectPath: string): string {
  if (!subjectPath) return '';

  const imports = sf.getImportDeclarations();
  const testFileName = path.basename(filePath);
  const baseNameWithoutExt = stripTestExtension(testFileName);

  // Name-based match (same logic as findSubjectByName)
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();
    if (isSkippableImport(source)) continue;
    if (matchesByBasename(source, baseNameWithoutExt)) return source;
  }

  // Resolved path match
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();
    if (isSkippableImport(source)) continue;
    if (decl.isTypeOnly()) continue;
    if (!source.startsWith('.') && !source.startsWith('@/')) continue;

    const resolved = resolveModulePath(source, filePath);
    if (resolved) {
      const resolvedRelative = path.relative(PROJECT_ROOT, resolved);
      if (resolvedRelative === subjectPath) return source;
    }
  }

  // Fallback: first relative non-test import (mirrors findSubjectByFirstRelativeImport)
  for (const decl of imports) {
    const source = decl.getModuleSpecifierValue();
    if (isTestHelperPath(source)) continue;
    if (decl.isTypeOnly()) continue;
    if (!source.startsWith('.') && !source.startsWith('@/')) continue;

    const resolved = resolveModulePath(source, filePath);
    if (resolved) {
      if (isTestFile(resolved)) continue;
      return source;
    }
    // Unresolvable but relative -- if its basename matches subjectPath's basename, use it
    if (path.basename(source).replace(/\.(ts|tsx)$/, '') === path.basename(subjectPath).replace(/\.(ts|tsx)$/, '')) {
      return source;
    }
    // This is the first non-skippable relative import -- it's the subject by convention
    return source;
  }

  return '';
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
// Vitest factory detection (.each patterns and factory functions)
// ---------------------------------------------------------------------------

interface EachExpansion {
  line: number;
  /** Number of test cases in the .each array */
  caseCount: number;
  /** The base name template (printf-style or template literal) */
  nameTemplate: string;
  /** 'test' | 'it' | 'describe' */
  blockType: string;
}

/**
 * Count elements in an array literal argument to .each().
 * Returns 0 if the argument is not a resolvable array.
 */
function countEachArrayElements(node: Node): number {
  if (Node.isArrayLiteralExpression(node)) {
    return node.getElements().length;
  }
  // .each(variableName) -- try to resolve the variable
  if (Node.isIdentifier(node)) {
    const refs = node.getDefinitionNodes?.();
    if (refs && refs.length > 0) {
      const defNode = refs[0];
      if (Node.isVariableDeclaration(defNode)) {
        const init = defNode.getInitializer();
        if (init && Node.isArrayLiteralExpression(init)) {
          return init.getElements().length;
        }
      }
    }
  }
  return 0;
}

/**
 * Detect .each() patterns: test.each([...])('name', fn),
 * it.each([...])('name', fn), describe.each([...])('name', fn).
 *
 * The .each() call returns a function that is immediately invoked with
 * the test name and callback. The AST structure is:
 *   CallExpression (outer) -- the invocation ('name', fn)
 *     CallExpression (inner) -- the .each([...]) call
 *       PropertyAccessExpression -- test.each / it.each / describe.each
 */
function detectEachPatterns(sf: SourceFile): EachExpansion[] {
  const expansions: EachExpansion[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    // The outer call: test.each([...])('name %s', fn)
    const outerExpr = node.getExpression();
    if (!Node.isCallExpression(outerExpr)) return;

    // The inner call: test.each([...])
    const innerExpr = outerExpr.getExpression();
    if (!Node.isPropertyAccessExpression(innerExpr)) return;

    const methodName = innerExpr.getName();
    if (methodName !== 'each') return;

    const baseExpr = innerExpr.getExpression();
    let blockType = '';
    if (Node.isIdentifier(baseExpr)) {
      const baseName = baseExpr.getText();
      if (baseName === 'test' || baseName === 'it') blockType = baseName;
      else if (baseName === 'describe') blockType = 'describe';
    }

    if (!blockType) return;

    // Count array elements from the .each() argument
    const eachArgs = outerExpr.getArguments();
    if (eachArgs.length === 0) return;
    const caseCount = countEachArrayElements(eachArgs[0]);

    // Get the name template from the outer invocation
    const outerArgs = node.getArguments();
    let nameTemplate = '';
    if (outerArgs.length > 0 && Node.isStringLiteral(outerArgs[0])) {
      nameTemplate = outerArgs[0].getLiteralValue();
    }

    expansions.push({
      line: node.getStartLineNumber(),
      caseCount,
      nameTemplate,
      blockType,
    });
  });

  return expansions;
}

/**
 * Vitest factory functions: functions containing test()/it() calls
 * that are invoked multiple times. Adapted from ast-pw-test-parity's
 * detectTestFactories pattern.
 */
interface VitestFactory {
  functionName: string;
  testCallLine: number;
  nameParamIndex: number;
  templatePrefix: string;
}

function detectVitestFactories(sf: SourceFile): VitestFactory[] {
  const factories: VitestFactory[] = [];

  sf.forEachDescendant(node => {
    let funcName = '';
    let funcBody: Node | undefined;
    let funcNode: Node = node;

    if (Node.isFunctionDeclaration(node) && node.getName()) {
      funcName = node.getName()!;
      funcBody = node.getBody();
      funcNode = node;
    } else if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        funcName = node.getName();
        funcBody = init.getBody();
        funcNode = node;
      }
    }

    if (!funcName || !funcBody) return;

    funcBody.forEachDescendant(inner => {
      if (!Node.isCallExpression(inner)) return;
      const callName = resolveCallName(inner);
      if (callName !== 'test' && callName !== 'it') return;

      const args = inner.getArguments();
      if (args.length < 2) return;

      const nameArg = args[0];
      if (!Node.isTemplateExpression(nameArg)) return;

      const head = nameArg.getHead().getText().slice(1, -2);

      let paramIndex = -1;
      const spans = nameArg.getTemplateSpans();
      if (spans.length > 0) {
        const firstSpanExpr = spans[0].getExpression();
        if (Node.isIdentifier(firstSpanExpr)) {
          const paramName = firstSpanExpr.getText();
          if (Node.isFunctionDeclaration(funcNode)) {
            const params = funcNode.getParameters();
            paramIndex = params.findIndex(p => p.getName() === paramName);
          } else if (Node.isVariableDeclaration(funcNode)) {
            const init = funcNode.getInitializer();
            if (init && Node.isArrowFunction(init)) {
              const params = init.getParameters();
              paramIndex = params.findIndex(p => p.getName() === paramName);
            }
          }
        }
      }

      if (paramIndex >= 0) {
        factories.push({
          functionName: funcName,
          testCallLine: inner.getStartLineNumber(),
          nameParamIndex: paramIndex,
          templatePrefix: head,
        });
      }
    });
  });

  return factories;
}

/**
 * Count factory invocations and return the expanded test count.
 */
function countFactoryInvocations(sf: SourceFile, factory: VitestFactory): number {
  let count = 0;

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;
    if (expr.getText() !== factory.functionName) return;

    const args = node.getArguments();
    if (args.length <= factory.nameParamIndex) return;
    count++;
  });

  return count;
}

/**
 * Compute the expanded test count by accounting for .each patterns
 * and factory functions. Returns the expanded count and per-expansion details.
 */
function computeExpandedTestCount(
  sf: SourceFile,
  baseTestCount: number,
): { expandedCount: number; eachExpansions: EachExpansion[]; factoryExpansions: VitestFactory[] } {
  const eachExpansions = detectEachPatterns(sf);
  const factoryExpansions = detectVitestFactories(sf);

  let expandedCount = baseTestCount;

  // For each .each pattern on test/it, the base count already includes 1 for
  // the test.each call itself. Replace that 1 with the actual case count.
  for (const each of eachExpansions) {
    if (each.blockType !== 'describe' && each.caseCount > 0) {
      // baseTestCount already counted this as 1 test, expand to caseCount
      expandedCount += each.caseCount - 1;
    }
  }

  // For each factory function, the test() inside the factory was counted once
  // in baseTestCount. Replace with the invocation count.
  for (const factory of factoryExpansions) {
    const invocationCount = countFactoryInvocations(sf, factory);
    if (invocationCount > 0) {
      // The test() inside the factory was counted once. Replace with invocations.
      expandedCount += invocationCount - 1;
    }
  }

  return { expandedCount, eachExpansions, factoryExpansions };
}

// ---------------------------------------------------------------------------
// Helper delegation tracking
// ---------------------------------------------------------------------------

/**
 * Names that should NOT be tracked as helper delegations.
 * Includes Vitest globals, assertion matchers, render calls,
 * standard library calls, and testing library utilities.
 */
const VITEST_HELPER_EXCLUSIONS = new Set([
  // Vitest globals
  'describe',
  'it',
  'test',
  'expect',
  'vi',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  // Testing library
  'render',
  'renderHook',
  'screen',
  'within',
  'waitFor',
  'act',
  'cleanup',
  'fireEvent',
  'userEvent',
  // Standard library
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'Promise',
  'Array',
  'Object',
  'JSON',
  'String',
  'Number',
  'Date',
  'Math',
  'parseInt',
  'parseFloat',
  'console',
  'require',
]);

interface HelperDelegation {
  line: number;
  functionName: string;
  argCount: number;
  isImported: boolean;
  sourceFile?: string;
}

/**
 * Build a map of imported function names to their source modules
 * for the given source file. Excludes imports from the subject
 * module (the module under test) and from non-relative paths.
 */
function buildImportedFunctionMap(
  sf: SourceFile,
  subjectSource: string,
): Map<string, { source: string; isRelative: boolean }> {
  const map = new Map<string, { source: string; isRelative: boolean }>();

  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    const isRelative = source.startsWith('.') || source.startsWith('@/');

    // Exclude the subject module -- functions from the subject are being
    // tested, not delegated to as helpers
    if (isSubjectImport(source, subjectSource)) continue;

    // Exclude Vitest/testing-library imports
    if (isPackageImport(source) && !source.startsWith('@/')) continue;

    for (const named of decl.getNamedImports()) {
      map.set(named.getName(), { source, isRelative });
    }

    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      map.set(defaultImport.getText(), { source, isRelative });
    }
  }

  return map;
}

/**
 * Check if an import source refers to the subject module.
 * Matches by basename comparison (the subject detection algorithm
 * strips test extensions and compares basenames).
 */
function isSubjectImport(importSource: string, subjectSource: string): boolean {
  if (!subjectSource) return false;
  // Direct match
  if (importSource === subjectSource) return true;
  // Basename match (e.g., '../utils/helpers' and subject 'helpers')
  const importBasename = path.basename(importSource).replace(/\.(ts|tsx)$/, '');
  const subjectBasename = path.basename(subjectSource).replace(/\.(ts|tsx)$/, '');
  return importBasename === subjectBasename;
}

/**
 * Collect local function declarations (not test blocks, not factory functions)
 * that may be helper functions.
 */
function buildLocalFunctionSet(sf: SourceFile): Set<string> {
  const locals = new Set<string>();

  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (name && !VITEST_HELPER_EXCLUSIONS.has(name)) {
      locals.add(name);
    }
  }

  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = decl.getName();
        if (!VITEST_HELPER_EXCLUSIONS.has(name)) {
          locals.add(name);
        }
      }
    }
  }

  return locals;
}

/**
 * Scan test body nodes for helper function calls.
 * Identifies standalone function calls and obj.method() calls that are
 * NOT assertion matchers, NOT render calls, NOT Vitest globals, and
 * NOT standard library calls.
 */
function extractHelperDelegations(
  sf: SourceFile,
  importMap: Map<string, { source: string; isRelative: boolean }>,
  localFunctions: Set<string>,
): HelperDelegation[] {
  const delegations: HelperDelegation[] = [];
  const seen = new Set<string>();

  // Only scan inside test/it callback bodies
  sf.forEachDescendant(outerNode => {
    if (!Node.isCallExpression(outerNode)) return;
    const outerExpr = outerNode.getExpression();

    let outerName = '';
    if (Node.isIdentifier(outerExpr)) {
      outerName = outerExpr.getText();
    } else if (Node.isPropertyAccessExpression(outerExpr)) {
      outerName = outerExpr.getExpression().getText();
    }

    if (outerName !== 'it' && outerName !== 'test') return;

    // Get the callback argument (last arg)
    const outerArgs = outerNode.getArguments();
    if (outerArgs.length < 2) return;
    const callback = outerArgs[outerArgs.length - 1];

    callback.forEachDescendant(innerNode => {
      if (!Node.isCallExpression(innerNode)) return;
      const innerExpr = innerNode.getExpression();

      // Standalone function call: helperFn(...)
      if (Node.isIdentifier(innerExpr)) {
        const fnName = innerExpr.getText();
        if (VITEST_HELPER_EXCLUSIONS.has(fnName)) return;

        const importInfo = importMap.get(fnName);
        const isLocal = localFunctions.has(fnName);

        // Only track if it is imported from a relative path or defined locally
        if (!importInfo?.isRelative && !isLocal) return;

        const key = `${fnName}:${innerNode.getStartLineNumber()}`;
        if (seen.has(key)) return;
        seen.add(key);

        delegations.push({
          line: innerNode.getStartLineNumber(),
          functionName: fnName,
          argCount: innerNode.getArguments().length,
          isImported: !!importInfo,
          sourceFile: importInfo?.source,
        });
      }

      // obj.method() calls -- skip vi.*, expect.*, screen.*
      if (Node.isPropertyAccessExpression(innerExpr)) {
        const objExpr = innerExpr.getExpression();
        if (!Node.isIdentifier(objExpr)) return;

        const objName = objExpr.getText();
        if (VITEST_HELPER_EXCLUSIONS.has(objName)) return;
        if (objName === 'vi') return;

        const methodName = innerExpr.getName();
        const qualifiedName = `${objName}.${methodName}`;

        const key = `${qualifiedName}:${innerNode.getStartLineNumber()}`;
        if (seen.has(key)) return;
        seen.add(key);

        const importInfo = importMap.get(objName);
        const isLocal = localFunctions.has(objName);

        if (!importInfo?.isRelative && !isLocal) return;

        delegations.push({
          line: innerNode.getStartLineNumber(),
          functionName: qualifiedName,
          argCount: innerNode.getArguments().length,
          isImported: !!importInfo,
          sourceFile: importInfo?.source,
        });
      }
    });
  });

  return delegations;
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
  authoritative?: boolean,
): TestObservation {
  if (authoritative) {
    return { kind, file, line, column, evidence, authoritative };
  }
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

/**
 * Check if a bare identifier was assigned from a screen.* query in the
 * same scope. Handles the pattern: `const x = screen.getByRole(...)` then
 * `expect(x).toHaveLength(1)`. Returns true when the variable's initializer
 * references a screen query.
 */
function isScreenQueryVariable(expectArg: Node): boolean {
  if (!Node.isIdentifier(expectArg)) return false;

  const name = expectArg.getText();

  // Walk up to the enclosing block/function to find variable declarations
  let current: Node | undefined = expectArg.getParent();
  while (current) {
    if (
      Node.isBlock(current) ||
      Node.isSourceFile(current) ||
      Node.isArrowFunction(current) ||
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current)
    ) {
      break;
    }
    current = current.getParent();
  }
  if (!current) return false;

  // Search for const/let/var declarations with the same name
  let found = false;
  current.forEachDescendant(node => {
    if (found) return;
    if (!Node.isVariableDeclaration(node)) return;
    if (node.getName() !== name) return;
    const init = node.getInitializer();
    if (!init) return;
    const initText = init.getText();
    if (initText.includes('screen.')) {
      found = true;
    }
  });

  return found;
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
    const directScreenQuery = expectArgText.includes('screen.');
    const indirectScreenQuery = !directScreenQuery && expectArgs.length > 0 && isScreenQueryVariable(expectArgs[0]);

    observations.push(
      createObservation('ASSERTION_CALL', filePath, line, node.getStart(), {
        matcherName: methodName,
        expectArgText: truncateText(expectArgText, astConfig.truncation.assertionMaxLength),
        isScreenQuery: directScreenQuery || indirectScreenQuery,
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

        for (const pattern of astConfig.testing.queryCacheClearPatterns) {
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

function extractBlockObservations(
  sf: SourceFile,
  filePath: string,
  eachExpansions: EachExpansion[],
): TestObservation[] {
  const observations: TestObservation[] = [];

  // Build a set of lines with .each expansions for quick lookup
  const eachLineMap = new Map<number, EachExpansion>();
  for (const each of eachExpansions) {
    eachLineMap.set(each.line, each);
  }

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
      // Check if this is an .each pattern by looking at the parent node
      const eachInfo = eachLineMap.get(line);
      const args = node.getArguments();
      const testName = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : undefined;

      if (eachInfo && eachInfo.blockType !== 'describe' && eachInfo.caseCount > 0) {
        observations.push(
          createObservation('TEST_BLOCK', filePath, line, node.getStart(), {
            testName: testName ?? eachInfo.nameTemplate,
            isExpanded: true,
            expandedCount: eachInfo.caseCount,
          }),
        );
      } else {
        observations.push(
          createObservation('TEST_BLOCK', filePath, line, node.getStart(), {
            testName,
          }),
        );
      }
    }
  });

  return observations;
}

function extractHelperDelegationObservations(delegations: HelperDelegation[], filePath: string): TestObservation[] {
  return delegations.map(d =>
    createObservation('TEST_HELPER_DELEGATION', filePath, d.line, 1, {
      delegationType: 'helper',
      functionName: d.functionName,
      argCount: d.argCount,
      isImported: d.isImported,
      sourceFile: d.sourceFile,
    }),
  );
}

/**
 * Detect 3+ sequential `mockResponseOnce` calls in a function body.
 * Sequential ordering creates fragile tests that break if query fire
 * order changes. URL-based `mockResponse` routing is preferred.
 */
function extractSequentialMockResponseObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    // Look for function-like bodies (function declarations, arrow functions, methods)
    if (!Node.isFunctionDeclaration(node) && !Node.isArrowFunction(node) && !Node.isMethodDeclaration(node)) {
      return;
    }

    const body = node.getBody();
    if (!body || !Node.isBlock(body)) return;

    const statements = body.getStatements();
    let consecutiveCount = 0;
    let firstLine = 0;

    for (const stmt of statements) {
      const text = stmt.getText();
      if (/\.mockResponseOnce\s*\(/.test(text)) {
        if (consecutiveCount === 0) {
          firstLine = stmt.getStartLineNumber();
        }
        consecutiveCount++;
      } else {
        if (consecutiveCount >= 3) {
          observations.push(
            createObservation('SEQUENTIAL_MOCK_RESPONSE', filePath, firstLine, 1, {
              sequentialCount: consecutiveCount,
              functionName: Node.isFunctionDeclaration(node) ? (node.getName() ?? '<anonymous>') : '<anonymous>',
            }),
          );
        }
        consecutiveCount = 0;
      }
    }

    // Check trailing sequence
    if (consecutiveCount >= 3) {
      observations.push(
        createObservation('SEQUENTIAL_MOCK_RESPONSE', filePath, firstLine, 1, {
          sequentialCount: consecutiveCount,
          functionName: Node.isFunctionDeclaration(node) ? (node.getName() ?? '<anonymous>') : '<anonymous>',
        }),
      );
    }
  });

  return observations;
}

/**
 * Detect `setTimeout` inside `new Promise` used before negative assertions.
 * Pattern: `await new Promise(r => setTimeout(r, N))` followed by
 * `expect(x).not.toHaveBeenCalled()`. This is a non-deterministic P9
 * violation -- when a query is disabled, no delay is needed.
 */
function extractTimerNegativeAssertionObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  sf.forEachDescendant(node => {
    // Look for: new Promise(r => setTimeout(r, N)) or new Promise(resolve => setTimeout(resolve, N))
    if (!Node.isNewExpression(node)) return;

    const exprText = node.getExpression().getText();
    if (exprText !== 'Promise') return;

    const fullText = node.getText();
    const setTimeoutMatch = /setTimeout\s*\(\s*\w+\s*,\s*(\d+)\s*\)/.exec(fullText);
    if (!setTimeoutMatch) return;

    const delayMs = parseInt(setTimeoutMatch[1], 10);
    const line = node.getStartLineNumber();

    // Check if statements AFTER the setTimeout in the same block contain
    // a negative assertion. Only flag "wait then assert not called" patterns,
    // not cases where a negative assertion precedes the timer.
    const parentBlock = node.getFirstAncestorByKind(SyntaxKind.Block);
    if (!parentBlock) return;

    const statements = parentBlock.getStatements();
    const timerStmtIndex = statements.findIndex(s => s.getStartLineNumber() === line);
    if (timerStmtIndex < 0) return;

    // Only check statements that come after the timer statement
    const afterTimerText = statements
      .slice(timerStmtIndex + 1)
      .map(s => s.getText())
      .join('\n');

    if (/\.not\.toHaveBeenCalled/.test(afterTimerText)) {
      observations.push(
        createObservation('TIMER_NEGATIVE_ASSERTION', filePath, line, 1, {
          delayMs,
        }),
      );
    }
  });

  return observations;
}

// ---------------------------------------------------------------------------
// Authoritative observation extraction
// ---------------------------------------------------------------------------

/**
 * Emit MOCK_INTERNAL for each vi.mock() targeting a project-internal module.
 * Confidence is 'high' when the target resolves to a file, 'medium' when
 * the target starts with './' or '@/' but could not be resolved.
 */
function extractMockInternalObservations(mocks: MockInfo[], filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];

  for (const mock of mocks) {
    const isRelative = mock.target.startsWith('.') || mock.target.startsWith('@/');
    if (!isRelative) continue;

    const resolvedToFile = mock.resolvedPath !== mock.target;
    const confidence = resolvedToFile ? ('high' as const) : ('medium' as const);

    observations.push(
      createObservation(
        'MOCK_INTERNAL',
        filePath,
        mock.line,
        1,
        { target: mock.target, resolvedPath: mock.resolvedPath, confidence },
        true,
      ),
    );
  }

  return observations;
}

/**
 * Emit MISSING_CLEANUP when a file has mocks or fake timers but no afterEach block.
 */
function extractMissingCleanupObservations(
  sf: SourceFile,
  filePath: string,
  mocks: MockInfo[],
  cleanup: CleanupInfo,
): TestObservation[] {
  if (cleanup.hasAfterEach) return [];

  const hasMocks = mocks.length > 0;
  const hasTimers = sf.getFullText().includes('useFakeTimers');

  if (!hasMocks && !hasTimers) return [];

  return [createObservation('MISSING_CLEANUP', filePath, 1, 1, { hasMocks, hasTimers }, true)];
}

/**
 * Emit DATA_SOURCING_VIOLATION when a test file uses `as any` casts
 * or imports from shared mutable test constants.
 */
function extractDataSourcingViolationObservations(filePath: string, dataSourcing: DataSourcingInfo): TestObservation[] {
  if (dataSourcing.asAnyCount === 0 && !dataSourcing.usesSharedMutableConstants) return [];

  return [
    createObservation(
      'DATA_SOURCING_VIOLATION',
      filePath,
      1,
      1,
      { asAnyCount: dataSourcing.asAnyCount, hasSharedMutable: dataSourcing.usesSharedMutableConstants },
      true,
    ),
  ];
}

// ---------------------------------------------------------------------------
// Implementation assertion patterns
// ---------------------------------------------------------------------------

/**
 * Regex patterns for detecting implementation-detail assertions.
 * These flag tests that assert on hook call arguments or mutation call
 * arguments instead of rendered output or user-visible behavior.
 *
 * Pattern 1: expect(useHookName).toHaveBeenCalled*
 * Pattern 2: expect(mutate/mutateAsync).toHaveBeenCalled*
 * Pattern 3: expect(mockUseHookName / mockedUseHookName).toHaveBeenCalled*
 */
const IMPLEMENTATION_ASSERTION_PATTERNS: readonly {
  regex: RegExp;
  assertionType: 'hook-call-args' | 'mutation-call-args';
  hookNameGroup: number;
}[] = [
  {
    regex: /expect\((use[A-Z]\w+)\)\.toHaveBeenCalled/,
    assertionType: 'hook-call-args',
    hookNameGroup: 1,
  },
  {
    regex: /expect\((mutate(?:Async)?)\)\.toHaveBeenCalled/,
    assertionType: 'mutation-call-args',
    hookNameGroup: 1,
  },
  {
    regex: /expect\((mock(?:ed)?(?:Use[A-Z]\w+))\)\.toHaveBeenCalled/,
    assertionType: 'hook-call-args',
    hookNameGroup: 1,
  },
];

/**
 * Emit IMPLEMENTATION_ASSERTION for expect() calls that assert on hook
 * or mutation call arguments instead of rendered output.
 *
 * All observations are authoritative. The patterns detect cases where
 * the test is verifying internal wiring (which hook was called and with
 * what arguments) rather than user-visible outcomes.
 */
function extractImplementationAssertionObservations(sf: SourceFile, filePath: string): TestObservation[] {
  const observations: TestObservation[] = [];
  const lines = sf.getFullText().split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { regex, assertionType, hookNameGroup } of IMPLEMENTATION_ASSERTION_PATTERNS) {
      const match = regex.exec(line);
      if (!match) continue;

      observations.push(
        createObservation(
          'IMPLEMENTATION_ASSERTION',
          filePath,
          i + 1,
          1,
          {
            hookName: match[hookNameGroup],
            assertionType,
            pattern: truncateText(line.trim(), 120),
          },
          true,
        ),
      );
    }
  }

  return observations;
}

export function extractTestObservations(
  sf: SourceFile,
  filePath: string,
  mocks: MockInfo[],
  eachExpansions: EachExpansion[] = [],
  helperDelegations: HelperDelegation[] = [],
  cleanup?: CleanupInfo,
  dataSourcing?: DataSourcingInfo,
): TestObservation[] {
  const relativePath = path.relative(PROJECT_ROOT, filePath);

  return [
    ...extractImportObservations(sf, relativePath),
    ...extractMockObservations(sf, relativePath, mocks),
    ...extractAssertionObservations(sf, relativePath),
    ...extractRenderObservations(sf, relativePath),
    ...extractProviderObservations(sf, relativePath),
    ...extractCleanupObservations(sf, relativePath),
    ...extractBlockObservations(sf, relativePath, eachExpansions),
    ...extractHelperDelegationObservations(helperDelegations, relativePath),
    ...extractSequentialMockResponseObservations(sf, relativePath),
    ...extractTimerNegativeAssertionObservations(sf, relativePath),
    ...extractMockInternalObservations(mocks, relativePath),
    ...extractImplementationAssertionObservations(sf, relativePath),
    ...(cleanup ? extractMissingCleanupObservations(sf, relativePath, mocks, cleanup) : []),
    ...(dataSourcing ? extractDataSourcingViolationObservations(relativePath, dataSourcing) : []),
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
  const { expandedCount, eachExpansions } = computeExpandedTestCount(sf, testCount);

  // Helper delegation tracking
  // Determine the subject module source to exclude from helper delegation.
  // We need the raw import source, not the resolved path.
  const subjectImportSource = detectSubjectImportSource(sf, absolute, subjectPath);
  const importMap = buildImportedFunctionMap(sf, subjectImportSource);
  const localFunctions = buildLocalFunctionSet(sf);
  const helperDelegations = extractHelperDelegations(sf, importMap, localFunctions);

  const observations = extractTestObservations(
    sf,
    absolute,
    mocks,
    eachExpansions,
    helperDelegations,
    cleanup,
    dataSourcing,
  );

  return {
    filePath: relativePath,
    subjectPath,
    subjectExists,
    isOrphaned,
    describeCount,
    testCount,
    expandedTestCount: expandedCount,
    mocks,
    assertions,
    cleanup,
    dataSourcing,
    observations,
  };
}

export function analyzeTestDirectory(dirPath: string, options: { noCache?: boolean } = {}): TestAnalysis[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const testFiles = getFilesInDirectory(absolute, 'test');

  const results: TestAnalysis[] = [];
  for (const fp of testFiles) {
    try {
      const analysis = cached('ast-test-analysis', fp, () => analyzeTestFile(fp), options);
      results.push(analysis);
    } catch (error) {
      process.stderr.write(
        `[ast-test-analysis] skipping unparseable file ${fp}: ${error instanceof Error ? error.message : error}\n`,
      );
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
      'Usage: npx tsx scripts/AST/ast-test-analysis.ts <path...> [--pretty] [--kind <kind>] [--count] [--no-cache]\n' +
        '\n' +
        'Analyze test file patterns: mocks, assertions, strategy, cleanup.\n' +
        '\n' +
        '  <path...>   One or more .spec.ts/.test.ts files or directories\n' +
        '  --pretty    Format JSON output with indentation\n' +
        '  --kind      Filter observations to a specific kind\n' +
        '  --count     Output observation kind counts instead of full data\n' +
        '  --no-cache  Bypass the file-content cache\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: TestAnalysis[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeTestDirectory(targetPath, { noCache }));
    } else {
      const result = cached('ast-test-analysis', absolute, () => analyzeTestFile(targetPath), { noCache });
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
  (process.argv[1].endsWith('ast-test-analysis.ts') || process.argv[1].endsWith('ast-test-analysis'));

if (isDirectRun) {
  main();
}
