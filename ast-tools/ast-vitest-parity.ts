/**
 * Vitest spec file inventory tool.
 *
 * Extracts structured test block data from Vitest spec files:
 * describe blocks (with nesting), test blocks, assertions, mocks,
 * render calls, fixture imports, lifecycle hooks (beforeEach/afterEach).
 *
 * This is an observation-only tool. Comparison and scoring live in a
 * separate interpreter (future Prompt 03).
 *
 * Supports reading files from a git branch via --source-branch, using
 * ts-morph's createSourceFile() with content from git show.
 */

import { type SourceFile, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { truncateText, resolveCallName, findExpectInChain, getFilesInDirectory } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import { gitShowFile, createVirtualProject } from './git-source';
import type {
  VtSpecInventory,
  VtDescribeBlock,
  VtTestBlock,
  VtMockDeclaration,
  VtAssertion,
  VtRenderCall,
  VtFixtureImport,
  VtLifecycleHook,
  VtParityObservation,
  VtParityObservationKind,
  VtParityObservationEvidence,
  ObservationResult,
} from './types';

// ---------------------------------------------------------------------------
// File detection
// ---------------------------------------------------------------------------

function isVitestSpec(filePath: string): boolean {
  return astConfig.vitestParity.testFileExtensions.some(ext => filePath.endsWith(ext));
}

/**
 * Check if a source file is a Playwright spec by looking at its imports.
 * Playwright specs import from `@playwright/test` or relative `fixture` paths.
 */
function isPlaywrightSpec(sf: SourceFile): boolean {
  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    if (astConfig.vitestParity.playwrightImports.some(pw => source === pw || source.endsWith(pw))) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function gitListSpecFiles(branch: string, dirPath: string): string[] {
  try {
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const result = execFileSync('git', ['ls-tree', '--name-only', '-r', `${branch}:${normalized}`], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.split('\n').filter(line => isVitestSpec(line));
  } catch {
    return [];
  }
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

/**
 * Compute nesting depth of a describe block by counting ancestor describe calls.
 */
function computeDescribeDepth(node: Node): number {
  let depth = 0;
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isCallExpression(current)) {
      const name = resolveCallName(current);
      if (name === 'describe') depth++;
    }
    current = current.getParent();
  }
  return depth;
}

/**
 * Count test blocks (it/test) that are direct children of a describe callback.
 */
function countTestsInDescribe(describeNode: Node): number {
  let count = 0;
  const args = Node.isCallExpression(describeNode) ? describeNode.getArguments() : [];
  if (args.length < 2) return 0;

  const callback = args[args.length - 1];
  callback.forEachChild(child => {
    // Walk statements, looking for it/test calls (not nested describes)
    if (Node.isExpressionStatement(child)) {
      const expr = child.getExpression();
      if (Node.isCallExpression(expr)) {
        const callName = resolveCallName(expr);
        if (callName === 'it' || callName === 'test') count++;
      }
    }
  });

  // Also check directly if callback body is a block
  if (Node.isArrowFunction(callback) || Node.isFunctionExpression(callback)) {
    const body = callback.getBody?.();
    if (body && Node.isBlock(body)) {
      for (const stmt of body.getStatements()) {
        if (Node.isExpressionStatement(stmt)) {
          const expr = stmt.getExpression();
          if (Node.isCallExpression(expr)) {
            const callName = resolveCallName(expr);
            if (callName === 'it' || callName === 'test') {
              // Already counted above via forEachChild? No, forEachChild
              // on the callback walks the callback node's children, not
              // the block's statements. Re-count from block.
            }
          }
        }
      }
    }
  }

  // Simpler approach: walk all descendants but only count direct test calls
  // (those whose nearest describe ancestor is this node)
  count = 0;
  describeNode.forEachDescendant(descendant => {
    if (!Node.isCallExpression(descendant)) return;
    const callName = resolveCallName(descendant);
    if (callName !== 'it' && callName !== 'test') return;

    // Check that the nearest describe ancestor is our node
    let parent: Node | undefined = descendant.getParent();
    while (parent) {
      if (Node.isCallExpression(parent)) {
        const parentName = resolveCallName(parent);
        if (parentName === 'describe') {
          if (parent === describeNode) count++;
          break;
        }
      }
      parent = parent.getParent();
    }
    // If no describe ancestor found, it means it's at module level - skip
  });

  return count;
}

// ---------------------------------------------------------------------------
// Describe block extraction
// ---------------------------------------------------------------------------

function extractDescribeBlocks(sf: SourceFile): VtDescribeBlock[] {
  const describes: VtDescribeBlock[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (callName !== 'describe') return;

    const args = node.getArguments();
    const name = args.length > 0 && Node.isStringLiteral(args[0]) ? args[0].getLiteralValue() : '<unnamed>';

    const nestedDepth = computeDescribeDepth(node);
    const testCount = countTestsInDescribe(node);

    describes.push({
      name,
      nestedDepth,
      testCount,
      line: node.getStartLineNumber(),
    });
  });

  return describes;
}

// ---------------------------------------------------------------------------
// Test block extraction
// ---------------------------------------------------------------------------

function extractTestBlocks(sf: SourceFile): VtTestBlock[] {
  const tests: VtTestBlock[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (callName !== 'it' && callName !== 'test') return;

    // Handle it.each / test.each -- skip the outer invocation pattern
    // (these are covered when we encounter the actual test call)

    const args = node.getArguments();
    if (args.length < 2) return;

    const nameArg = args[0];
    let testName = '';
    if (Node.isStringLiteral(nameArg)) {
      testName = nameArg.getLiteralValue();
    } else if (Node.isNoSubstitutionTemplateLiteral(nameArg)) {
      testName = truncateText(nameArg.getText(), 120);
    } else {
      testName = truncateText(nameArg.getText(), 80);
    }

    const parentDescribe = findEnclosingDescribe(node);

    // Count assertions inside this test's callback
    const callback = args[args.length - 1];
    let assertionCount = 0;
    const assertionSeen = new Set<number>();
    callback.forEachDescendant(inner => {
      if (!Node.isCallExpression(inner)) return;
      const expr = inner.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;
      const methodName = expr.getName();
      if (!methodName.startsWith('to')) return;
      const expectCall = findExpectInChain(inner);
      if (!expectCall) return;
      const line = inner.getStartLineNumber();
      if (assertionSeen.has(line)) return;
      assertionSeen.add(line);
      assertionCount++;
    });

    tests.push({
      name: testName,
      parentDescribe,
      assertionCount,
      line: node.getStartLineNumber(),
    });
  });

  return tests;
}

// ---------------------------------------------------------------------------
// Assertion extraction
// ---------------------------------------------------------------------------

function extractAssertions(sf: SourceFile, tests: VtTestBlock[]): VtAssertion[] {
  const assertions: VtAssertion[] = [];

  // Build a map of test line -> test name for parent resolution
  sf.forEachDescendant(outerNode => {
    if (!Node.isCallExpression(outerNode)) return;
    const outerName = resolveCallName(outerNode);
    if (outerName !== 'it' && outerName !== 'test') return;

    const outerArgs = outerNode.getArguments();
    if (outerArgs.length < 2) return;

    const nameArg = outerArgs[0];
    let testName = '';
    if (Node.isStringLiteral(nameArg)) {
      testName = nameArg.getLiteralValue();
    } else {
      testName = truncateText(nameArg.getText(), 80);
    }

    const callback = outerArgs[outerArgs.length - 1];
    const seen = new Set<number>();

    callback.forEachDescendant(inner => {
      if (!Node.isCallExpression(inner)) return;
      const expr = inner.getExpression();
      if (!Node.isPropertyAccessExpression(expr)) return;

      const methodName = expr.getName();
      if (!methodName.startsWith('to')) return;

      const expectCall = findExpectInChain(inner);
      if (!expectCall) return;
      if (!Node.isCallExpression(expectCall)) return;

      const line = inner.getStartLineNumber();
      if (seen.has(line)) return;
      seen.add(line);

      const expectArgs = expectCall.getArguments();
      const target =
        expectArgs.length > 0 ? truncateText(expectArgs[0].getText(), astConfig.truncation.assertionMaxLength) : '';

      // Check for negation (.not.)
      let negated = false;
      let walkExpr = expr.getExpression();
      while (Node.isPropertyAccessExpression(walkExpr)) {
        if (walkExpr.getName() === 'not') {
          negated = true;
          break;
        }
        walkExpr = walkExpr.getExpression();
      }

      assertions.push({
        matcher: methodName,
        target,
        negated,
        parentTest: testName,
        line,
      });
    });
  });

  return assertions;
}

// ---------------------------------------------------------------------------
// Mock extraction
// ---------------------------------------------------------------------------

function extractMocks(sf: SourceFile): VtMockDeclaration[] {
  const mocks: VtMockDeclaration[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const objText = expr.getExpression().getText();
    if (objText !== 'vi') return;

    const methodName = expr.getName();
    const line = node.getStartLineNumber();
    const parentDescribe = findEnclosingDescribe(node);

    if (methodName === 'mock') {
      const args = node.getArguments();
      if (args.length === 0) return;
      const firstArg = args[0];
      if (!Node.isStringLiteral(firstArg)) return;
      mocks.push({
        mockTarget: firstArg.getLiteralValue(),
        mockType: 'vi.mock',
        parentDescribe,
        line,
      });
    } else if (methodName === 'spyOn') {
      const args = node.getArguments();
      if (args.length < 2) return;
      const spyTarget = args[0].getText();
      const spyMethod = Node.isStringLiteral(args[1]) ? args[1].getLiteralValue() : args[1].getText();
      mocks.push({
        mockTarget: `${spyTarget}.${spyMethod}`,
        mockType: 'vi.spyOn',
        parentDescribe,
        line,
      });
    } else if (methodName === 'fn') {
      mocks.push({
        mockTarget: '<inline>',
        mockType: 'vi.fn',
        parentDescribe,
        line,
      });
    }
  });

  return mocks;
}

// ---------------------------------------------------------------------------
// Render call extraction
// ---------------------------------------------------------------------------

function extractRenderCalls(sf: SourceFile): VtRenderCall[] {
  const renders: VtRenderCall[] = [];

  sf.forEachDescendant(outerNode => {
    if (!Node.isCallExpression(outerNode)) return;
    const outerName = resolveCallName(outerNode);
    if (outerName !== 'it' && outerName !== 'test') return;

    const outerArgs = outerNode.getArguments();
    if (outerArgs.length < 2) return;

    const nameArg = outerArgs[0];
    let testName = '';
    if (Node.isStringLiteral(nameArg)) {
      testName = nameArg.getLiteralValue();
    } else {
      testName = truncateText(nameArg.getText(), 80);
    }

    const callback = outerArgs[outerArgs.length - 1];
    callback.forEachDescendant(inner => {
      if (!Node.isCallExpression(inner)) return;
      const innerExpr = inner.getExpression();
      if (!Node.isIdentifier(innerExpr)) return;

      const name = innerExpr.getText();
      if (name !== 'render' && name !== 'renderHook') return;

      const fullText = inner.getText();
      const hasWrapper = fullText.includes('wrapper');

      // Try to extract component name from render(<Component />)
      let component = '';
      const renderArgs = inner.getArguments();
      if (renderArgs.length > 0) {
        const firstArg = renderArgs[0];
        const argText = firstArg.getText();
        // Extract component name from JSX: <ComponentName ... />
        const jsxMatch = /^<(\w+)/.exec(argText);
        if (jsxMatch) {
          component = jsxMatch[1];
        } else {
          component = truncateText(argText, 60);
        }
      }

      renders.push({
        component,
        hasWrapper,
        parentTest: testName,
        line: inner.getStartLineNumber(),
      });
    });
  });

  return renders;
}

// ---------------------------------------------------------------------------
// Fixture import extraction
// ---------------------------------------------------------------------------

function extractFixtureImports(sf: SourceFile): VtFixtureImport[] {
  const imports: VtFixtureImport[] = [];

  for (const decl of sf.getImportDeclarations()) {
    const source = decl.getModuleSpecifierValue();
    const isFixture = astConfig.testing.fixtureImportPatterns.some(
      pattern => source.includes(pattern) || source === pattern || source.startsWith(pattern + '/'),
    );
    if (!isFixture) continue;

    const builders = decl.getNamedImports().map(ni => ni.getName());
    imports.push({
      source,
      builders,
      line: decl.getStartLineNumber(),
    });
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Lifecycle hook extraction
// ---------------------------------------------------------------------------

function extractLifecycleHooks(sf: SourceFile): VtLifecycleHook[] {
  const hooks: VtLifecycleHook[] = [];
  const hookNames = new Set(['beforeEach', 'afterEach', 'beforeAll', 'afterAll']);

  sf.forEachDescendant(node => {
    if (!Node.isCallExpression(node)) return;
    const expr = node.getExpression();
    if (!Node.isIdentifier(expr)) return;

    const name = expr.getText();
    if (!hookNames.has(name)) return;

    const hookType = name as VtLifecycleHook['hookType'];
    const scope = findEnclosingDescribe(node) ?? '<module>';
    const line = node.getStartLineNumber();

    // Detect cleanup patterns in the callback body
    const cleanupTargets: string[] = [];
    const args = node.getArguments();
    if (args.length > 0) {
      const callbackText = args[0].getText();
      for (const pattern of astConfig.vitestParity.cleanupPatterns) {
        if (callbackText.includes(pattern)) {
          cleanupTargets.push(pattern);
        }
      }
    }

    hooks.push({ hookType, cleanupTargets, scope, line });
  });

  return hooks;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inventory a single Vitest spec file.
 */
export function analyzeVitestParity(filePath: string): VtSpecInventory {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const project = createVirtualProject();
  const content = fs.readFileSync(absolute, 'utf-8');
  const virtualPath = path.join(PROJECT_ROOT, '__vt_virtual__', path.basename(absolute));
  const sf = project.createSourceFile(virtualPath, content);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  return buildInventory(sf, relativePath);
}

/**
 * Inventory all Vitest spec files in a directory, with caching.
 */
export function analyzeVitestParityDirectory(dirPath: string, options: { noCache?: boolean } = {}): VtSpecInventory[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);
  const testFiles = getFilesInDirectory(absolute, 'test');
  const results: VtSpecInventory[] = [];

  for (const fullPath of testFiles) {
    // Skip non-Vitest files (Playwright specs)
    try {
      const project = createVirtualProject();
      const content = fs.readFileSync(fullPath, 'utf-8');
      const virtualPath = path.join(PROJECT_ROOT, '__vt_detect__', path.basename(fullPath));
      const sf = project.createSourceFile(virtualPath, content);
      if (isPlaywrightSpec(sf)) continue;
    } catch {
      continue;
    }

    const analysis = cached('ast-vitest-parity', fullPath, () => analyzeVitestParity(fullPath), options);
    results.push(analysis);
  }

  return results;
}

/**
 * Inventory Vitest spec files from a git branch (no caching).
 */
export function analyzeVitestParityBranch(branch: string, dirPath: string): VtSpecInventory[] {
  const files = gitListSpecFiles(branch, dirPath);
  if (files.length === 0) return [];

  const project = createVirtualProject();
  const inventories: VtSpecInventory[] = [];

  for (const fileName of files) {
    const gitPath = dirPath.endsWith('/') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`;
    const content = gitShowFile(branch, gitPath);
    if (!content) {
      process.stderr.write(`[ast-vitest-parity] Could not read ${branch}:${gitPath}, skipping\n`);
      continue;
    }

    const virtualPath = path.join(PROJECT_ROOT, '__vt_branch_virtual__', fileName);
    const sf = project.createSourceFile(virtualPath, content);

    // Skip Playwright specs even in branch mode
    if (isPlaywrightSpec(sf)) continue;

    inventories.push(buildInventory(sf, gitPath));
  }

  return inventories;
}

// ---------------------------------------------------------------------------
// Inventory builder
// ---------------------------------------------------------------------------

function buildInventory(sf: SourceFile, filePath: string): VtSpecInventory {
  const describes = extractDescribeBlocks(sf);
  const tests = extractTestBlocks(sf);
  const mocks = extractMocks(sf);
  const assertions = extractAssertions(sf, tests);
  const renders = extractRenderCalls(sf);
  const fixtureImports = extractFixtureImports(sf);
  const lifecycleHooks = extractLifecycleHooks(sf);

  return {
    file: filePath,
    describes,
    tests,
    mocks,
    assertions,
    renders,
    fixtureImports,
    lifecycleHooks,
  };
}

// ---------------------------------------------------------------------------
// Observation extraction
// ---------------------------------------------------------------------------

export function extractVitestParityObservations(analysis: VtSpecInventory): ObservationResult<VtParityObservation> {
  const observations: VtParityObservation[] = [];

  function obs(
    kind: VtParityObservationKind,
    line: number,
    evidence: VtParityObservationEvidence,
  ): VtParityObservation {
    return { kind, file: analysis.file, line, evidence };
  }

  // Describe blocks
  for (const desc of analysis.describes) {
    observations.push(
      obs('VT_DESCRIBE_BLOCK', desc.line, {
        name: desc.name,
        nestedDepth: desc.nestedDepth,
        testCount: desc.testCount,
      }),
    );
  }

  // Test blocks
  for (const test of analysis.tests) {
    observations.push(
      obs('VT_TEST_BLOCK', test.line, {
        name: test.name,
        parentDescribe: test.parentDescribe,
        assertionCount: test.assertionCount,
      }),
    );
  }

  // Assertions
  for (const assertion of analysis.assertions) {
    observations.push(
      obs('VT_ASSERTION', assertion.line, {
        matcher: assertion.matcher,
        target: assertion.target,
        negated: assertion.negated,
        parentTest: assertion.parentTest,
      }),
    );
  }

  // Mock declarations
  for (const mock of analysis.mocks) {
    observations.push(
      obs('VT_MOCK_DECLARATION', mock.line, {
        mockTarget: mock.mockTarget,
        mockType: mock.mockType,
        parentDescribe: mock.parentDescribe,
      }),
    );
  }

  // Render calls
  for (const render of analysis.renders) {
    observations.push(
      obs('VT_RENDER_CALL', render.line, {
        component: render.component,
        hasWrapper: render.hasWrapper,
        parentTest: render.parentTest,
      }),
    );
  }

  // Fixture imports
  for (const fi of analysis.fixtureImports) {
    observations.push(
      obs('VT_FIXTURE_IMPORT', fi.line, {
        source: fi.source,
        builders: fi.builders,
      }),
    );
  }

  // Lifecycle hooks -- split into VT_BEFORE_EACH and VT_AFTER_EACH
  for (const hook of analysis.lifecycleHooks) {
    if (hook.hookType === 'beforeEach' || hook.hookType === 'beforeAll') {
      observations.push(
        obs('VT_BEFORE_EACH', hook.line, {
          hookType: hook.hookType,
          scope: hook.scope,
          cleanupTargets: hook.cleanupTargets,
        }),
      );
    } else if (hook.hookType === 'afterEach' || hook.hookType === 'afterAll') {
      observations.push(
        obs('VT_AFTER_EACH', hook.line, {
          hookType: hook.hookType,
          scope: hook.scope,
          cleanupTargets: hook.cleanupTargets,
        }),
      );
    }
  }

  return { filePath: analysis.file, observations };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const NAMED_OPTIONS = ['--source-branch', '--source-dir'] as const;

function main(): void {
  const args = parseArgs(process.argv, { namedOptions: NAMED_OPTIONS });
  const noCache = args.flags.has('no-cache');
  const sourceBranch = args.options['source-branch'] ?? null;
  const sourceDir = args.options['source-dir'] ?? null;

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-vitest-parity.ts <dir-or-file> [--pretty] [--no-cache]\n' +
        '       npx tsx scripts/AST/ast-vitest-parity.ts --source-branch <branch> --source-dir <dir> [--pretty]\n' +
        '\n' +
        'Inventory Vitest spec files: describe blocks, test blocks, assertions,\n' +
        'mocks, render calls, fixture imports, lifecycle hooks.\n' +
        '\n' +
        '  <dir-or-file>    File or directory of Vitest spec files to inventory\n' +
        '  --source-branch  Git branch to read files from (instead of filesystem)\n' +
        '  --source-dir     Directory path on the git branch\n' +
        '  --pretty         Format JSON output with indentation\n' +
        '  --kind <KIND>    Filter observations to a specific kind\n' +
        '  --count          Output observation kind counts\n' +
        '  --no-cache       Bypass cache and recompute\n',
    );
    process.exit(0);
  }

  // Branch mode
  if (sourceBranch && sourceDir) {
    const results = analyzeVitestParityBranch(sourceBranch, sourceDir);
    const allObs = results.map(r => ({
      ...r,
      observations: extractVitestParityObservations(r).observations,
    }));
    outputFiltered(allObs, args.pretty, {
      kind: args.options.kind,
      count: args.flags.has('count'),
    });
    return;
  }

  // File or directory mode
  const targetPath = args.paths[0];
  if (!targetPath) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

  if (!fs.existsSync(absolute)) {
    fatal(`Path does not exist: ${targetPath}`);
  }

  const stat = fs.statSync(absolute);

  if (stat.isDirectory()) {
    const results = analyzeVitestParityDirectory(targetPath, { noCache });
    const allObs = results.map(r => ({
      ...r,
      observations: extractVitestParityObservations(r).observations,
    }));
    outputFiltered(allObs, args.pretty, {
      kind: args.options.kind,
      count: args.flags.has('count'),
    });
  } else {
    const result = cached('ast-vitest-parity', absolute, () => analyzeVitestParity(targetPath), { noCache });
    const withObs = {
      ...result,
      observations: extractVitestParityObservations(result).observations,
    };
    outputFiltered(withObs, args.pretty, {
      kind: args.options.kind,
      count: args.flags.has('count'),
    });
  }

  const stats = getCacheStats();
  if (stats.hits > 0 || stats.misses > 0) {
    process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-vitest-parity.ts') || process.argv[1].endsWith('ast-vitest-parity'));

if (isDirectRun) {
  main();
}
