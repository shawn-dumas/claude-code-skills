/**
 * Playwright spec file inventory tool.
 *
 * Extracts structured test block data from Playwright spec files:
 * test names, assertions (matcher + target), page.route() intercepts,
 * page.goto() navigations, POM instantiations, auth method, serial mode.
 *
 * This is an observation-only tool. Comparison and scoring live in
 * ast-interpret-test-parity.ts.
 *
 * Supports reading files from a git branch via --source-branch, using
 * ts-morph's createSourceFile() with content from git show.
 */

import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { PROJECT_ROOT } from './project';
import { parseArgs, output, fatal } from './cli';
import { truncateText, findExpectInChain, resolveCallName, resolveTemplateLiteral } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import { gitShowFile, createVirtualProject } from './git-source';
import type {
  PwSpecInventory,
  PwTestBlock,
  PwAssertionDetail,
  PwRouteIntercept,
  PwHelperDelegation,
  PwHelperEntry,
  PwHelperIndex,
  PwParityObservation,
  PwParityObservationKind,
  PwParityObservationEvidence,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// Git helpers (gitShowFile imported from git-source.ts)
// ---------------------------------------------------------------------------

function gitListSpecFiles(branch: string, dirPath: string): string[] {
  try {
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const result = execFileSync('git', ['ls-tree', '--name-only', `${branch}:${normalized}`], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.split('\n').filter(line => line.endsWith('.spec.ts') || line.endsWith('.spec.tsx'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Auth method detection
// ---------------------------------------------------------------------------

function detectAuthMethod(sf: SourceFile): string | null {
  const text = sf.getFullText();
  for (const method of astConfig.testParity.authMethods) {
    if (text.includes(method)) return method;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Serial mode detection
// ---------------------------------------------------------------------------

function detectSerialMode(sf: SourceFile): boolean {
  return sf.getFullText().includes("mode: 'serial'");
}

// ---------------------------------------------------------------------------
// beforeEach detection
// ---------------------------------------------------------------------------

function hasBeforeEach(sf: SourceFile): boolean {
  return sf.getFullText().includes('beforeEach');
}

// ---------------------------------------------------------------------------
// Describe block extraction (resolveCallName imported from shared.ts)
// ---------------------------------------------------------------------------

function extractDescribes(sf: SourceFile): string[] {
  const describes: string[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const name = resolveCallName(node);
    if (name !== 'describe') return;

    const args = node.getArguments();
    if (args.length > 0 && Node.isStringLiteral(args[0])) {
      describes.push(args[0].getLiteralValue());
    }
  });

  return describes;
}

// ---------------------------------------------------------------------------
// Enclosing describe detection
// ---------------------------------------------------------------------------

function findEnclosingDescribe(node: Node): string | null {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isCallExpression(current)) {
      const name = resolveCallName(current);
      if (name === 'describe') {
        const args = current.getArguments();
        if (args.length > 0 && Node.isStringLiteral(args[0])) {
          return args[0].getLiteralValue();
        }
        return '<unnamed describe>';
      }
    }
    current = current.getParent();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Test block extraction with per-test assertion/route/nav/POM counting
// ---------------------------------------------------------------------------

// Names that are not helper delegations (Playwright API, expect, language)
const BUILTIN_CALL_NAMES = new Set([
  'expect',
  'require',
  'console',
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
]);

function isFileSkipGuard(testNode: Node): boolean {
  if (!Node.isCallExpression(testNode)) return false;

  const expr = testNode.getExpression();
  if (!Node.isPropertyAccessExpression(expr)) return false;
  if (expr.getName() !== 'skip') return false;

  const args = testNode.getArguments();
  if (args.length === 0) return false;

  const firstArg = args[0];
  return firstArg.getText() === 'true' || firstArg.getText() === 'false';
}

/**
 * Detect factory-pattern tests: functions that wrap test() calls
 * and are invoked multiple times. Returns the factory function names
 * and the test() call nodes inside them.
 */
interface TestFactory {
  functionName: string;
  testCallNode: Node;
  /** Index of the parameter used in the template literal test name */
  nameParamIndex: number;
  /** The template prefix before the parameter interpolation */
  templatePrefix: string;
  /** The full template expression node for resolveTemplateLiteral */
  templateNode: import('ts-morph').TemplateExpression;
  /** The parameter name used in the template interpolation */
  paramName: string;
}

function detectTestFactories(sf: SourceFile): TestFactory[] {
  const factories: TestFactory[] = [];

  // Find function declarations and variable declarations that contain test() calls
  sf.forEachDescendant(node => {
    let funcName = '';
    let funcBody: Node | undefined;

    if (Node.isFunctionDeclaration(node) && node.getName()) {
      funcName = node.getName()!;
      funcBody = node.getBody();
    } else if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (init && Node.isArrowFunction(init)) {
        funcName = node.getName();
        funcBody = init.getBody();
      }
    }

    if (!funcName || !funcBody) return;

    // Look for test() / it() calls inside this function
    funcBody.forEachDescendant(inner => {
      if (!Node.isCallExpression(inner)) return;
      const callName = resolveCallName(inner);
      if (callName !== 'test' && callName !== 'it') return;

      const args = inner.getArguments();
      if (args.length < 2) return;

      const nameArg = args[0];
      // Must be a template literal with interpolation (template expression)
      if (!Node.isTemplateExpression(nameArg)) return;

      const head = nameArg.getHead().getText().slice(1, -2); // strip ` and ${

      // Find which parameter of the enclosing function is used in the template
      let paramIndex = -1;
      const spans = nameArg.getTemplateSpans();
      if (spans.length > 0) {
        const firstSpanExpr = spans[0].getExpression();
        if (Node.isIdentifier(firstSpanExpr)) {
          const paramName = firstSpanExpr.getText();
          // Find this parameter in the enclosing function
          if (Node.isFunctionDeclaration(node)) {
            const params = node.getParameters();
            paramIndex = params.findIndex(p => p.getName() === paramName);
          } else if (Node.isVariableDeclaration(node)) {
            const init = node.getInitializer();
            if (init && Node.isArrowFunction(init)) {
              const params = init.getParameters();
              paramIndex = params.findIndex(p => p.getName() === paramName);
            }
          }
        }
      }

      if (paramIndex >= 0) {
        const firstSpanExprNode = spans[0].getExpression();
        const resolvedParamName = Node.isIdentifier(firstSpanExprNode) ? firstSpanExprNode.getText() : '';
        factories.push({
          functionName: funcName,
          testCallNode: inner,
          nameParamIndex: paramIndex,
          templatePrefix: head,
          templateNode: nameArg,
          paramName: resolvedParamName,
        });
      }
    });
  });

  return factories;
}

/**
 * Find all call sites of a factory function and resolve the test name
 * from the argument at nameParamIndex.
 */
function expandFactoryInvocations(
  sf: SourceFile,
  factory: TestFactory,
): { resolvedName: string; callSiteLine: number }[] {
  const results: { resolvedName: string; callSiteLine: number }[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;
    if (expr.getText() !== factory.functionName) return;

    // Skip the factory function definition itself
    // (the test() call inside the factory is at a different position)
    const args = node.getArguments();
    if (args.length <= factory.nameParamIndex) return;

    const nameArg = args[factory.nameParamIndex];
    const argValue = Node.isStringLiteral(nameArg) ? nameArg.getLiteralValue() : truncateText(nameArg.getText(), 80);
    const bindings = new Map<string, string>([[factory.paramName, argValue]]);
    const resolvedName = resolveTemplateLiteral(factory.templateNode, bindings);

    results.push({
      resolvedName,
      callSiteLine: node.getStartLineNumber(),
    });
  });

  return results;
}

interface TestBodySignals {
  assertions: PwAssertionDetail[];
  routeIntercepts: PwRouteIntercept[];
  navigations: string[];
  pomUsages: string[];
  helperDelegations: PwHelperDelegation[];
}

/**
 * Extract all structural signals from a test callback body node.
 * Shared between direct test extraction and factory expansion.
 */
function extractTestBodySignals(callbackNode: Node): TestBodySignals {
  const assertions: PwAssertionDetail[] = [];
  const routeIntercepts: PwRouteIntercept[] = [];
  const navigations: string[] = [];
  const poms = new Set<string>();
  const helpers: PwHelperDelegation[] = [];
  const assertionSeen = new Set<number>();
  const helperSeen = new Set<string>();

  callbackNode.forEachDescendant(innerNode => {
    if (!Node.isCallExpression(innerNode) && !Node.isNewExpression(innerNode)) return;

    if (Node.isCallExpression(innerNode)) {
      const innerExpr = innerNode.getExpression();
      if (Node.isPropertyAccessExpression(innerExpr)) {
        const methodName = innerExpr.getName();

        // expect().toXxx() -- only terminal matchers, not chain modifiers
        // (resolves/rejects are chain modifiers, not assertions)
        if (methodName.startsWith('to')) {
          const expectCall = findExpectInChain(innerNode);
          if (expectCall && Node.isCallExpression(expectCall)) {
            const assertLine = innerNode.getStartLineNumber();
            if (!assertionSeen.has(assertLine)) {
              assertionSeen.add(assertLine);
              const expectArgs = expectCall.getArguments();
              const target =
                expectArgs.length > 0
                  ? truncateText(expectArgs[0].getText(), astConfig.truncation.assertionMaxLength)
                  : '';
              assertions.push({ line: assertLine, matcher: methodName, target });
            }
          }
        }

        // page.route()
        if (methodName === 'route') {
          const routeObj = innerExpr.getExpression();
          if (Node.isIdentifier(routeObj) && astConfig.testParity.pageObjects.has(routeObj.getText())) {
            const routeArgs = innerNode.getArguments();
            if (routeArgs.length > 0) {
              const firstArg = routeArgs[0];
              let urlPattern = '';
              if (Node.isStringLiteral(firstArg)) urlPattern = firstArg.getLiteralValue();
              else if (Node.isRegularExpressionLiteral(firstArg)) urlPattern = firstArg.getText();
              else urlPattern = truncateText(firstArg.getText(), 100);
              routeIntercepts.push({ line: innerNode.getStartLineNumber(), urlPattern });
            }
          }
        }

        // page.goto() / context.goto()
        if (methodName === 'goto') {
          const gotoObj = innerExpr.getExpression();
          if (Node.isIdentifier(gotoObj) && astConfig.testParity.pageObjects.has(gotoObj.getText())) {
            const gotoArgs = innerNode.getArguments();
            if (gotoArgs.length > 0) {
              const firstArg = gotoArgs[0];
              if (Node.isStringLiteral(firstArg)) navigations.push(firstArg.getLiteralValue());
              else navigations.push(truncateText(firstArg.getText(), 100));
            }
          }
        }
      }

      // Helper delegation: standalone function calls
      if (Node.isIdentifier(innerExpr)) {
        const fnName = innerExpr.getText();
        if (!BUILTIN_CALL_NAMES.has(fnName) && !helperSeen.has(fnName)) {
          if (fnName !== 'expect' && fnName !== 'test' && fnName !== 'it' && fnName !== 'describe') {
            helperSeen.add(fnName);
            helpers.push({
              line: innerNode.getStartLineNumber(),
              functionName: fnName,
              argCount: innerNode.getArguments().length,
            });
          }
        }
      }

      // POM method calls: usersPage.verifyColumns(), nav.goToInsights()
      if (Node.isPropertyAccessExpression(innerExpr)) {
        const objExpr = innerExpr.getExpression();
        if (Node.isIdentifier(objExpr)) {
          const objName = objExpr.getText();
          const mName = innerExpr.getName();
          if (
            !astConfig.testParity.pageObjects.has(objName) &&
            objName !== 'expect' &&
            objName !== 'route' &&
            objName !== 'console'
          ) {
            const key = `${objName}.${mName}`;
            if (!helperSeen.has(key)) {
              helperSeen.add(key);
              helpers.push({
                line: innerNode.getStartLineNumber(),
                functionName: key,
                argCount: innerNode.getArguments().length,
              });
            }
          }
        }
      }
    }

    // POM usage: new XxxPage(page)
    if (Node.isNewExpression(innerNode)) {
      const newExpr = innerNode.getExpression();
      if (Node.isIdentifier(newExpr) && newExpr.getText().endsWith(astConfig.testParity.pomSuffix)) {
        poms.add(newExpr.getText());
      }
    }
  });

  return { assertions, routeIntercepts, navigations, pomUsages: [...poms], helperDelegations: helpers };
}

function extractTestBlocks(sf: SourceFile, specFilePath?: string): PwTestBlock[] {
  const tests: PwTestBlock[] = [];
  const testNodes: Node[] = [];

  // Track which test() calls are inside factory functions (not direct tests)
  const factoryTestLines = new Set<number>();
  const factories = detectTestFactories(sf);
  for (const f of factories) {
    factoryTestLines.add(f.testCallNode.getStartLineNumber());
  }

  const testCallNames = new Set(['test', 'it', 'only', 'skip', 'fixme']);

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (!testCallNames.has(callName)) return;

    // For 'only'/'skip'/'fixme', verify the base is test/it
    if (callName !== 'test' && callName !== 'it') {
      const expr = node.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      const base = expr.getExpression();
      if (!Node.isIdentifier(base)) return;
      if (base.getText() !== 'test' && base.getText() !== 'it') return;
    }

    // Skip test() calls inside factory functions -- they'll be expanded below
    if (factoryTestLines.has(node.getStartLineNumber())) return;

    testNodes.push(node);
  });

  for (const testNode of testNodes) {
    if (!Node.isCallExpression(testNode)) continue;
    if (isFileSkipGuard(testNode)) continue;

    const args = testNode.getArguments();
    if (args.length < 2) continue;

    const nameArg = args[0];
    let testName = '';
    if (Node.isStringLiteral(nameArg)) {
      testName = nameArg.getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(nameArg)) {
      testName = truncateText(nameArg.getText(), 120);
    } else {
      testName = truncateText(nameArg.getText(), 80);
    }

    const line = testNode.getStartLineNumber();
    const describeParent = findEnclosingDescribe(testNode);
    const callback = args[args.length - 1];
    const signals = extractTestBodySignals(callback);

    tests.push({
      name: testName,
      line,
      describeParent,
      assertionCount: signals.assertions.length,
      ...signals,
    });
  }

  // Expand factory-pattern tests: for each factory, find all call sites
  // and create a PwTestBlock per invocation with the resolved test name.
  // The test body (assertions, routes, etc.) comes from the factory's
  // internal test() call, shared across all invocations.
  for (const factory of factories) {
    const invocations = expandFactoryInvocations(sf, factory);
    if (invocations.length === 0) continue;

    // Extract signals from the factory's test() call body once
    const factoryTestNode = factory.testCallNode;
    if (!Node.isCallExpression(factoryTestNode)) continue;

    const fArgs = factoryTestNode.getArguments();
    if (fArgs.length < 2) continue;

    const fCallback = fArgs[fArgs.length - 1];
    const factorySignals = extractTestBodySignals(fCallback);

    // Create one PwTestBlock per invocation, with the resolved name.
    // Spread all arrays to avoid shared mutable references across siblings.
    for (const inv of invocations) {
      tests.push({
        name: inv.resolvedName,
        line: inv.callSiteLine,
        describeParent: null,
        assertionCount: factorySignals.assertions.length,
        assertions: [...factorySignals.assertions],
        routeIntercepts: [...factorySignals.routeIntercepts],
        navigations: [...factorySignals.navigations],
        pomUsages: [...factorySignals.pomUsages],
        helperDelegations: [...factorySignals.helperDelegations],
      });
    }
  }

  // Cross-file factory expansion: if the spec file has 0 tests after
  // direct + in-file factory expansion, check for imports of factory
  // functions that define tests internally.
  // NOTE: Only works when specFilePath resolves to a real filesystem path.
  // In branch mode, specFilePath is a bare filename and factory resolution
  // will silently fail (fs.existsSync on the import path returns false).
  // This is acceptable because branch mode is used for source (e2e) specs
  // which don't use cross-file factories in the current codebase.
  if (tests.length === 0 && specFilePath) {
    const specDir = path.dirname(
      path.isAbsolute(specFilePath) ? specFilePath : path.resolve(PROJECT_ROOT, specFilePath),
    );
    // Only attempt cross-file resolution if the spec directory exists on disk
    if (fs.existsSync(specDir)) {
      const crossFileTests = expandCrossFileFactories(sf, specFilePath);
      tests.push(...crossFileTests);
    }
  }

  return tests;
}

// ---------------------------------------------------------------------------
// Cross-file factory detection
// ---------------------------------------------------------------------------

/**
 * Detect when a spec file imports a function from a relative path and
 * calls it at the top level, where the imported function defines tests.
 *
 * Pattern:
 *   // bpo.spec.ts
 *   import { defineSettingsCrudTests } from './settings-crud.factory';
 *   defineSettingsCrudTests({ entityLabel: 'BPO', ... });
 *
 *   // settings-crud.factory.ts
 *   export function defineSettingsCrudTests(config) {
 *     const { entityLabel } = config;
 *     test(`Create ${entityLabel}, ...`, async ({ page }) => { ... });
 *   }
 */
function expandCrossFileFactories(sf: SourceFile, specFilePath: string): PwTestBlock[] {
  const tests: PwTestBlock[] = [];

  // 1. Find relative imports
  const relativeImports = new Map<string, string>(); // functionName -> resolved file path
  sf.getImportDeclarations().forEach(decl => {
    const moduleSpec = decl.getModuleSpecifierValue();
    if (!moduleSpec.startsWith('.')) return;

    const specDir = path.dirname(
      path.isAbsolute(specFilePath) ? specFilePath : path.resolve(PROJECT_ROOT, specFilePath),
    );

    // Resolve the import path
    const candidates = [
      path.resolve(specDir, `${moduleSpec}.ts`),
      path.resolve(specDir, `${moduleSpec}.tsx`),
      path.resolve(specDir, moduleSpec, 'index.ts'),
    ];
    const resolvedPath = candidates.find(c => fs.existsSync(c));
    if (!resolvedPath) return;

    // Map each named import to the resolved file
    for (const named of decl.getNamedImports()) {
      relativeImports.set(named.getName(), resolvedPath);
    }
  });

  if (relativeImports.size === 0) return tests;

  // 2. Find top-level calls to imported functions
  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;

    const funcName = expr.getText();
    const factoryFilePath = relativeImports.get(funcName);
    if (!factoryFilePath) return;

    // 3. Extract the call site argument (first arg, typically an object literal)
    const callArgs = node.getArguments();
    const argProperties = new Map<string, string>(); // property name -> literal value

    if (callArgs.length > 0) {
      const firstArg = callArgs[0];
      if (Node.isObjectLiteralExpression(firstArg)) {
        for (const prop of firstArg.getProperties()) {
          if (Node.isPropertyAssignment(prop)) {
            const name = prop.getName();
            const init = prop.getInitializer();
            if (init && Node.isStringLiteral(init)) {
              argProperties.set(name, init.getLiteralValue());
            }
          }
        }
      }
    }

    // 4. Parse the factory file and find the exported function
    const factoryProject = createVirtualProject();
    const factoryContent = fs.readFileSync(factoryFilePath, 'utf-8');
    const virtualPath = path.join(PROJECT_ROOT, '__pw_crossfile_factory__', path.basename(factoryFilePath));
    const factorySf = factoryProject.createSourceFile(virtualPath, factoryContent);

    // Find the exported function matching funcName
    factorySf.forEachDescendant(fNode => {
      if (!Node.isFunctionDeclaration(fNode)) return;
      if (fNode.getName() !== funcName) return;

      const funcBody = fNode.getBody();
      if (!funcBody) return;

      // Build a variable->value map from destructuring of the parameter.
      // Pattern: const { entityLabel, settingsTab } = config;
      // Or direct parameter destructuring.
      const paramMap = new Map<string, string>(argProperties);

      // Check for destructuring statements inside the function body
      funcBody.forEachDescendant(inner => {
        if (!Node.isVariableDeclaration(inner)) return;
        const nameNode = inner.getNameNode();
        if (!Node.isObjectBindingPattern(nameNode)) return;

        // Check if the initializer references a parameter
        const init = inner.getInitializer();
        if (!init || !Node.isIdentifier(init)) return;

        // The parameter name (e.g., 'config')
        const paramName = init.getText();
        const funcParams = fNode.getParameters();
        const isParam = funcParams.some(p => p.getName() === paramName);
        if (!isParam) return;

        // Map each binding element to the call site property value
        for (const element of nameNode.getElements()) {
          const bindingName = element.getName();
          const value = argProperties.get(bindingName);
          if (value !== undefined) {
            paramMap.set(bindingName, value);
          }
        }
      });

      // Find test() calls inside this function
      funcBody.forEachDescendant(inner => {
        if (!Node.isCallExpression(inner)) return;
        const callName = resolveCallName(inner);
        if (callName !== 'test' && callName !== 'it') return;

        const testArgs = inner.getArguments();
        if (testArgs.length < 2) return;

        const nameArg = testArgs[0];
        let testName = '';

        if (Node.isStringLiteral(nameArg)) {
          testName = nameArg.getLiteralValue();
        } else if (Node.isTemplateExpression(nameArg)) {
          // Resolve template by substituting known variables
          const head = nameArg.getHead().getText().slice(1, -2); // strip ` and ${
          let resolved = head;
          for (const span of nameArg.getTemplateSpans()) {
            const spanExpr = span.getExpression();
            const varName = Node.isIdentifier(spanExpr) ? spanExpr.getText() : '';
            const value = paramMap.get(varName) ?? `\${${varName}}`;
            const literal = span.getLiteral().getText();
            // The literal includes the closing } and any text until the next ${ or `
            // For TemplateMiddle: text between } and ${
            // For TemplateTail: text between } and `
            const tailText = literal.slice(1, literal.endsWith('`') ? -1 : -2);
            resolved += value + tailText;
          }
          testName = resolved;
        } else {
          testName = truncateText(nameArg.getText(), 80);
        }

        if (!testName) return;

        // Extract test body signals
        const callback = testArgs[testArgs.length - 1];
        const signals = extractTestBodySignals(callback);

        tests.push({
          name: testName,
          line: node.getStartLineNumber(), // line in the spec file
          describeParent: null,
          assertionCount: signals.assertions.length,
          assertions: [...signals.assertions],
          routeIntercepts: [...signals.routeIntercepts],
          navigations: [...signals.navigations],
          pomUsages: [...signals.pomUsages],
          helperDelegations: [...signals.helperDelegations],
        });
      });
    });
  });

  return tests;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inventory a single Playwright spec file.
 */
export function analyzeTestParity(filePath: string): PwSpecInventory {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const project = createVirtualProject();
  const content = fs.readFileSync(absolute, 'utf-8');
  const virtualPath = path.join(PROJECT_ROOT, '__pw_virtual__', path.basename(absolute));
  const sf = project.createSourceFile(virtualPath, content);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  return buildInventory(sf, relativePath, absolute);
}

/**
 * Inventory all spec files in a directory, with caching.
 */
export function analyzeTestParityDirectory(dirPath: string, options: { noCache?: boolean } = {}): PwSpecInventory[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const entries = fs.readdirSync(absolute).filter(f => f.endsWith('.spec.ts') || f.endsWith('.spec.tsx'));
  const results: PwSpecInventory[] = [];

  for (const entry of entries) {
    const fullPath = path.join(absolute, entry);
    const analysis = cached('ast-test-parity', fullPath, () => analyzeTestParity(fullPath), options);
    results.push(analysis);
  }

  return results;
}

/**
 * Inventory spec files from a git branch (no caching -- branch content is volatile).
 */
export function analyzeTestParityBranch(branch: string, dirPath: string): PwSpecInventory[] {
  const files = gitListSpecFiles(branch, dirPath);
  if (files.length === 0) {
    return [];
  }

  const project = createVirtualProject();
  const inventories: PwSpecInventory[] = [];

  for (const fileName of files) {
    const gitPath = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`;
    const content = gitShowFile(branch, gitPath);
    if (!content) {
      process.stderr.write(`[ast-test-parity] Could not read ${branch}:${gitPath}, skipping\n`);
      continue;
    }

    const virtualPath = path.join(PROJECT_ROOT, '__pw_branch_virtual__', fileName);
    const sf = project.createSourceFile(virtualPath, content);
    inventories.push(buildInventory(sf, fileName));
  }

  return inventories;
}

// ---------------------------------------------------------------------------
// Helper file inventory (POM classes, utility functions -> assertion counts)
// ---------------------------------------------------------------------------

/**
 * Analyze a single helper/POM file. Extracts function and method declarations,
 * counts expect() assertions inside each. Returns a flat list of entries.
 */
export function analyzeHelperFile(filePath: string): PwHelperEntry[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const project = createVirtualProject();
  const content = fs.readFileSync(absolute, 'utf-8');
  const virtualPath = path.join(PROJECT_ROOT, '__pw_helper_virtual__', path.basename(absolute));
  const sf = project.createSourceFile(virtualPath, content);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const entries: PwHelperEntry[] = [];

  sf.forEachDescendant(node => {
    // Class methods: ClassName.methodName
    if (Node.isMethodDeclaration(node)) {
      const methodName = node.getName();
      const parent = node.getParent();
      if (!Node.isClassDeclaration(parent)) return;
      const className = parent.getName() ?? '<anon>';
      const qualifiedName = `${className}.${methodName}`;

      const assertionCount = countAssertionsInNode(node);
      entries.push({ qualifiedName, assertionCount, filePath: relativePath, line: node.getStartLineNumber() });
      return;
    }

    // Standalone function declarations
    if (Node.isFunctionDeclaration(node) && node.getName()) {
      const funcName = node.getName()!;
      const assertionCount = countAssertionsInNode(node);
      entries.push({
        qualifiedName: funcName,
        assertionCount,
        filePath: relativePath,
        line: node.getStartLineNumber(),
      });
      return;
    }

    // Arrow functions assigned to const
    if (Node.isVariableDeclaration(node)) {
      const init = node.getInitializer();
      if (!init) return;
      if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) return;

      const funcName = node.getName();
      const assertionCount = countAssertionsInNode(init);
      entries.push({
        qualifiedName: funcName,
        assertionCount,
        filePath: relativePath,
        line: node.getStartLineNumber(),
      });
    }
  });

  return entries;
}

/**
 * Count expect().toXxx() assertion calls inside a node.
 */
function countAssertionsInNode(node: Node): number {
  let count = 0;
  const seen = new Set<number>();

  node.forEachDescendant(inner => {
    if (!Node.isCallExpression(inner)) return;
    const expr = inner.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const methodName = expr.getName();
    if (!methodName.startsWith('to')) return;

    const expectCall = findExpectInChain(inner);
    if (!expectCall) return;

    const line = inner.getStartLineNumber();
    if (seen.has(line)) return;
    seen.add(line);
    count++;
  });

  return count;
}

/**
 * Build a helper index from one or more directories of helper/POM files.
 * Results are cached per file.
 */
export function buildHelperIndex(helperDirs: string[], options: { noCache?: boolean } = {}): PwHelperIndex {
  const entries: PwHelperEntry[] = [];

  for (const dir of helperDirs) {
    const absolute = path.isAbsolute(dir) ? dir : path.resolve(PROJECT_ROOT, dir);
    if (!fs.existsSync(absolute)) continue;

    const files = fs
      .readdirSync(absolute)
      .filter(f => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'index.ts');

    for (const file of files) {
      const fullPath = path.join(absolute, file);
      const fileEntries = cached('ast-test-parity-helpers', fullPath, () => analyzeHelperFile(fullPath), options);
      entries.push(...fileEntries);
    }
  }

  const lookup: Record<string, number> = {};
  for (const entry of entries) {
    lookup[entry.qualifiedName] = entry.assertionCount;
  }

  return { entries, lookup };
}

/**
 * Build a helper index from git branch directories.
 */
export function buildHelperIndexFromBranch(branch: string, helperDirs: string[]): PwHelperIndex {
  const entries: PwHelperEntry[] = [];
  const project = createVirtualProject();

  for (const dir of helperDirs) {
    const files = gitListDir(branch, dir);
    for (const file of files) {
      if (file.endsWith('.spec.ts') || file === 'index.ts') continue;
      if (!file.endsWith('.ts')) continue;

      const gitPath = dir.endsWith('/') ? `${dir}${file}` : `${dir}/${file}`;
      const content = gitShowFile(branch, gitPath);
      if (!content) continue;

      // Include dir basename in virtual path to avoid collisions when
      // multiple helperDirs contain files with the same name.
      const dirBasename = path.basename(dir.replace(/\/$/, ''));
      const virtualPath = path.join(PROJECT_ROOT, '__pw_helper_branch__', dirBasename, file);
      const sf = project.createSourceFile(virtualPath, content);
      const relativePath = file;

      sf.forEachDescendant(node => {
        if (Node.isMethodDeclaration(node)) {
          const methodName = node.getName();
          const parent = node.getParent();
          if (!Node.isClassDeclaration(parent)) return;
          const className = parent.getName() ?? '<anon>';
          entries.push({
            qualifiedName: `${className}.${methodName}`,
            assertionCount: countAssertionsInNode(node),
            filePath: relativePath,
            line: node.getStartLineNumber(),
          });
        }

        if (Node.isFunctionDeclaration(node) && node.getName()) {
          entries.push({
            qualifiedName: node.getName()!,
            assertionCount: countAssertionsInNode(node),
            filePath: relativePath,
            line: node.getStartLineNumber(),
          });
        }

        if (Node.isVariableDeclaration(node)) {
          const init = node.getInitializer();
          if (!init) return;
          if (!Node.isArrowFunction(init) && !Node.isFunctionExpression(init)) return;
          entries.push({
            qualifiedName: node.getName(),
            assertionCount: countAssertionsInNode(init),
            filePath: relativePath,
            line: node.getStartLineNumber(),
          });
        }
      });
    }
  }

  const lookup: Record<string, number> = {};
  for (const e of entries) {
    lookup[e.qualifiedName] = e.assertionCount;
  }

  return { entries, lookup };
}

/**
 * List files in a git branch directory (not just spec files).
 */
function gitListDir(branch: string, dirPath: string): string[] {
  try {
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const result = execFileSync('git', ['ls-tree', '--name-only', `${branch}:${normalized}`], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Inventory builder (shared between file, directory, and branch modes)
// ---------------------------------------------------------------------------

function buildInventory(sf: SourceFile, filePath: string, absolutePath?: string): PwSpecInventory {
  const describes = extractDescribes(sf);
  const tests = extractTestBlocks(sf, absolutePath ?? filePath);
  const totalAssertions = tests.reduce((sum, t) => sum + t.assertionCount, 0);
  const totalRouteIntercepts = tests.reduce((sum, t) => sum + t.routeIntercepts.length, 0);

  return {
    filePath,
    describes,
    tests,
    totalAssertions,
    totalRouteIntercepts,
    beforeEachPresent: hasBeforeEach(sf),
    serialMode: detectSerialMode(sf),
    authMethod: detectAuthMethod(sf),
  };
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractTestParityObservations(analysis: PwSpecInventory): ObservationResult<PwParityObservation> {
  const observations: PwParityObservation[] = [];

  function obs(
    kind: PwParityObservationKind,
    line: number,
    evidence: PwParityObservationEvidence,
  ): PwParityObservation {
    return { kind, file: analysis.filePath, line, evidence };
  }

  // Auth call
  if (analysis.authMethod) {
    observations.push(obs('PW_AUTH_CALL', 1, { method: analysis.authMethod }));
  }

  // Serial mode
  if (analysis.serialMode) {
    observations.push(obs('PW_SERIAL_MODE', 1, {}));
  }

  // beforeEach
  if (analysis.beforeEachPresent) {
    observations.push(obs('PW_BEFORE_EACH', 1, {}));
  }

  // Per-test observations
  for (const test of analysis.tests) {
    observations.push(
      obs('PW_TEST_BLOCK', test.line, {
        testName: test.name,
        describeName: test.describeParent,
        assertionCount: test.assertionCount,
        routeInterceptCount: test.routeIntercepts.length,
        navigationCount: test.navigations.length,
        pomCount: test.pomUsages.length,
        helperDelegationCount: test.helperDelegations.length,
      }),
    );

    for (const assertion of test.assertions) {
      observations.push(
        obs('PW_ASSERTION', assertion.line, {
          testName: test.name,
          matcher: assertion.matcher,
          target: assertion.target,
        }),
      );
    }

    for (const intercept of test.routeIntercepts) {
      observations.push(
        obs('PW_ROUTE_INTERCEPT', intercept.line, {
          testName: test.name,
          urlPattern: intercept.urlPattern,
        }),
      );
    }

    for (const nav of test.navigations) {
      observations.push(
        obs('PW_NAVIGATION', test.line, {
          testName: test.name,
          url: nav,
        }),
      );
    }

    for (const pom of test.pomUsages) {
      observations.push(
        obs('PW_POM_USAGE', test.line, {
          testName: test.name,
          className: pom,
        }),
      );
    }

    for (const helper of test.helperDelegations) {
      observations.push(
        obs('PW_HELPER_DELEGATION', helper.line, {
          testName: test.name,
          functionName: helper.functionName,
          argCount: helper.argCount,
        }),
      );
    }
  }

  return { filePath: analysis.filePath, observations };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const NAMED_OPTIONS = ['--source-branch', '--source-dir'] as const;

function main(): void {
  const args = parseArgs(process.argv, NAMED_OPTIONS);
  const noCache = process.argv.includes('--no-cache');
  const sourceBranch = args.options['source-branch'] ?? null;
  const sourceDir = args.options['source-dir'] ?? null;

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-test-parity.ts <dir> [--pretty] [--no-cache]\n' +
        '       npx tsx scripts/AST/ast-test-parity.ts --source-branch <branch> --source-dir <dir> [--pretty]\n' +
        '\n' +
        'Inventory Playwright spec files: test blocks, assertions, route intercepts,\n' +
        'navigations, POM usage, auth method, serial mode.\n' +
        '\n' +
        '  <dir>            Directory of .spec.ts files to inventory\n' +
        '  --source-branch  Git branch to read files from (instead of filesystem)\n' +
        '  --source-dir     Directory path on the git branch\n' +
        '  --pretty         Format JSON output with indentation\n' +
        '  --no-cache       Bypass cache and recompute\n',
    );
    process.exit(0);
  }

  // Branch mode
  if (sourceBranch && sourceDir) {
    const results = analyzeTestParityBranch(sourceBranch, sourceDir);
    output(results, args.pretty);
    return;
  }

  // Directory mode
  const targetDir = args.paths[0];
  if (!targetDir) {
    fatal('No directory path provided. Use --help for usage.');
  }

  const absolute = path.isAbsolute(targetDir) ? targetDir : path.resolve(PROJECT_ROOT, targetDir);

  if (!fs.existsSync(absolute)) {
    fatal(`Path does not exist: ${targetDir}`);
  }

  const stat = fs.statSync(absolute);

  if (stat.isDirectory()) {
    const results = analyzeTestParityDirectory(targetDir, { noCache });
    output(results, args.pretty);
    const stats = getCacheStats();
    if (stats.hits > 0 || stats.misses > 0) {
      process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
    }
  } else {
    const result = cached('ast-test-parity', absolute, () => analyzeTestParity(targetDir), { noCache });
    output(result, args.pretty);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-test-parity.ts') || process.argv[1].endsWith('ast-test-parity'));

if (isDirectRun) {
  main();
}
