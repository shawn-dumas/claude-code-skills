/**
 * Shared utilities for AST tools. Extracted to avoid duplication across tools.
 *
 * - truncateText, getContainingFunctionName: common helpers used by most tools
 * - getFilesInDirectory: recursive TS/TSX file discovery with consistent exclusions
 * - isPascalCase, containsJsx, getBody: component detection primitives
 * - detectComponents: unified component detector with full metadata (name, line, kind, wrapperCall)
 */

import fs from 'fs';
import path from 'path';
import {
  type SourceFile,
  type FunctionDeclaration,
  type CallExpression,
  type TemplateExpression,
  SyntaxKind,
  Node,
} from 'ts-morph';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function truncateText(text: string, maxLen: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.substring(0, maxLen - 3) + '...';
}

// ---------------------------------------------------------------------------
// Containing function detection
// ---------------------------------------------------------------------------

const HOOK_OPTION_PROPERTIES = new Set([
  'queryFn',
  'mutationFn',
  'onSuccess',
  'onError',
  'onSettled',
  'onMutate',
  'select',
  'enabled',
]);

/**
 * For an arrow function or function expression, resolve the name from
 * its parent context. Returns the name string, 'skip' to continue
 * walking past a hook-option callback, or null if unresolvable.
 */
function resolveClosureName(current: Node): string | 'skip' | null {
  const parent = current.getParent();
  if (parent && Node.isVariableDeclaration(parent)) {
    return parent.getName();
  }
  if (parent && Node.isPropertyAssignment(parent)) {
    const propName = parent.getName();
    if (HOOK_OPTION_PROPERTIES.has(propName)) return 'skip';
    return propName;
  }
  if (Node.isFunctionExpression(current) && current.getName()) {
    return current.getName()!;
  }
  return null;
}

export function getContainingFunctionName(node: Node): string {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName() ?? '<anonymous>';
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const name = resolveClosureName(current);
      if (name === 'skip') {
        current = current.getParent();
        continue;
      }
      if (name) return name;
      current = current.getParent();
      continue;
    }
    if (Node.isMethodDeclaration(current)) {
      return current.getName();
    }
    current = current.getParent();
  }
  return '<module>';
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist']);

/** Filename suffixes that identify test files. */
const TEST_SUFFIXES = ['.spec.ts', '.spec.tsx', '.test.ts', '.test.tsx'];

export type FileFilter = 'production' | 'test' | 'all';

/**
 * Recursively collect .ts/.tsx files from a directory.
 *
 * - `'production'` (default): excludes test files (.spec.*, .test.*) and .d.ts
 * - `'test'`: includes only test files, excludes .d.ts
 * - `'all'`: includes both production and test files, excludes .d.ts
 *
 * Always skips node_modules, .next, and dist directories.
 */
export function getFilesInDirectory(dirPath: string, filter: FileFilter = 'production'): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...getFilesInDirectory(fullPath, filter));
    } else if (entry.isFile()) {
      const name = entry.name;
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
      if (name.endsWith('.d.ts')) continue;

      const isTest = TEST_SUFFIXES.some(suffix => name.endsWith(suffix));

      if (filter === 'production' && !isTest) results.push(fullPath);
      else if (filter === 'test' && isTest) results.push(fullPath);
      else if (filter === 'all') results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component detection
// ---------------------------------------------------------------------------

export function isPascalCase(name: string): boolean {
  return name.length > 0 && name[0] >= 'A' && name[0] <= 'Z';
}

const JSX_KINDS = new Set([SyntaxKind.JsxElement, SyntaxKind.JsxSelfClosingElement, SyntaxKind.JsxFragment]);

const JSX_RETURN_TYPE_MARKERS = ['JSX', 'ReactNode', 'ReactElement'];

/** Check whether a function-like node has a JSX/ReactNode return type annotation. */
function hasJsxReturnType(node: Node): boolean {
  if (!Node.isFunctionDeclaration(node) && !Node.isArrowFunction(node) && !Node.isFunctionExpression(node)) {
    return false;
  }
  const returnType = (node as FunctionDeclaration).getReturnTypeNode?.();
  if (!returnType) return false;
  const text = returnType.getText();
  return JSX_RETURN_TYPE_MARKERS.some(marker => text.includes(marker));
}

/**
 * Check whether a function node contains JSX in its body or has a JSX/ReactNode
 * return type annotation. The react-inventory version (richer) is used here --
 * it checks both return type annotations and body content.
 */
export function containsJsx(node: Node): boolean {
  if (hasJsxReturnType(node)) return true;

  let found = false;
  node.forEachDescendant(child => {
    if (found) return;
    if (JSX_KINDS.has(child.getKind())) found = true;
  });
  return found;
}

export function getBody(node: Node): (Node & { getStatements(): Node[] }) | null {
  if (Node.isFunctionDeclaration(node)) {
    return (node.getBody() as (Node & { getStatements(): Node[] }) | undefined) ?? null;
  }
  if (Node.isArrowFunction(node)) {
    const body = node.getBody();
    if (Node.isBlock(body)) return body as Node & { getStatements(): Node[] };
    return null;
  }
  if (Node.isFunctionExpression(node)) {
    return node.getBody() as Node & { getStatements(): Node[] };
  }
  return null;
}

export type ComponentKind = 'function' | 'arrow' | 'memo' | 'forwardRef';

export interface DetectedComponent {
  name: string;
  line: number;
  kind: ComponentKind;
  funcNode: Node;
  /** For memo/forwardRef, the wrapping CallExpression -- used for type arg extraction */
  wrapperCall: Node | null;
}

// Callee names recognized as wrapper HOCs
const WRAPPER_HOC_MAP: Record<string, ComponentKind> = {
  memo: 'memo',
  'React.memo': 'memo',
  forwardRef: 'forwardRef',
  'React.forwardRef': 'forwardRef',
};

function detectFunctionComponents(sf: SourceFile): DetectedComponent[] {
  const components: DetectedComponent[] = [];
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (!name || !isPascalCase(name)) continue;
    if (containsJsx(func)) {
      components.push({ name, line: func.getStartLineNumber(), kind: 'function', funcNode: func, wrapperCall: null });
    }
  }
  return components;
}

function classifyVariableDeclaration(
  name: string,
  decl: Node & { getStartLineNumber(): number },
  init: Node,
): DetectedComponent | null {
  // Arrow function or function expression
  if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
    if (!containsJsx(init)) return null;
    return { name, line: decl.getStartLineNumber(), kind: 'arrow', funcNode: init, wrapperCall: null };
  }

  // memo() / forwardRef() wrappers
  if (!Node.isCallExpression(init)) return null;
  const wrapperKind = WRAPPER_HOC_MAP[init.getExpression().getText()];
  if (!wrapperKind) return null;

  const args = init.getArguments();
  if (args.length === 0) return null;

  const inner = args[0];
  if ((Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) && containsJsx(inner)) {
    return { name, line: decl.getStartLineNumber(), kind: wrapperKind, funcNode: inner, wrapperCall: init };
  }

  return null;
}

function detectVariableComponents(sf: SourceFile): DetectedComponent[] {
  const components: DetectedComponent[] = [];

  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isPascalCase(name)) continue;

      const init = decl.getInitializer();
      if (!init) continue;

      const comp = classifyVariableDeclaration(name, decl, init);
      if (comp) components.push(comp);
    }
  }

  return components;
}

function detectInnerFunctionComponents(sf: SourceFile, alreadyFound: DetectedComponent[]): DetectedComponent[] {
  const components: DetectedComponent[] = [];

  sf.forEachDescendant(node => {
    if (!Node.isFunctionDeclaration(node)) return;
    const name = node.getName();
    if (!name || !isPascalCase(name)) return;
    if (alreadyFound.some(c => c.name === name && c.line === node.getStartLineNumber())) return;
    if (containsJsx(node)) {
      components.push({ name, line: node.getStartLineNumber(), kind: 'function', funcNode: node, wrapperCall: null });
    }
  });

  return components;
}

/**
 * Detect React components in a source file. Returns component metadata
 * including name, line, kind (function/arrow/memo/forwardRef), the function
 * node, and the wrapper call expression (for memo/forwardRef).
 */
export function detectComponents(sf: SourceFile): DetectedComponent[] {
  const funcComponents = detectFunctionComponents(sf);
  const varComponents = detectVariableComponents(sf);
  const topLevel = [...funcComponents, ...varComponents];
  const innerComponents = detectInnerFunctionComponents(sf, topLevel);
  return [...topLevel, ...innerComponents];
}

// ---------------------------------------------------------------------------
// Expect chain walking (shared by ast-test-analysis and ast-test-parity)
// ---------------------------------------------------------------------------

/**
 * Walk down a chain like expect(x).not.toBe(y) to find the expect() call
 * at the bottom. Walks only downward (into child expressions), never up
 * to parent nodes, avoiding infinite recursion.
 *
 * Handles patterns:
 *   - expect(x).toBe(y)
 *   - expect(x).not.toBe(y)
 *   - await expect(x).resolves.toBe(y)
 */
export function findExpectInChain(node: Node): CallExpression | null {
  let current: Node | undefined = node;

  for (let depth = 0; depth < 10; depth++) {
    if (!current) return null;

    if (Node.isCallExpression(current)) {
      const expr = current.getExpression();
      if (Node.isIdentifier(expr) && expr.getText() === 'expect') {
        return current;
      }
      current = expr;
      continue;
    }

    if (Node.isPropertyAccessExpression(current)) {
      current = current.getExpression();
      continue;
    }

    break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Call name resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective call name from a call expression.
 * Handles namespaced calls: test.describe() -> 'describe',
 * React.memo() -> 'memo'. Returns the final method/function name.
 * Returns '' for non-call-expression nodes.
 */
export function resolveCallName(node: Node): string {
  if (!Node.isCallExpression(node)) return '';
  const expr = node.getExpression();

  // Plain identifier: test(), describe(), it()
  if (Node.isIdentifier(expr)) return expr.getText();

  // Property access: test.describe(), React.memo(), test.skip()
  if (Node.isPropertyAccessExpression(expr)) {
    const methodName = expr.getName();
    const obj = expr.getExpression();

    // test.describe.configure() -> 'configure'
    // test.describe() -> 'describe'
    if (Node.isIdentifier(obj) && (obj.getText() === 'test' || obj.getText() === 'it')) {
      return methodName;
    }

    // test.describe.configure() -- nested property access
    if (Node.isPropertyAccessExpression(obj)) {
      return methodName;
    }

    // describe.each(), React.memo() -> base name (the method)
    return methodName;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Template literal resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a ts-morph TemplateExpression node by substituting known variable
 * bindings. Unknown variables are left as `${varName}`.
 */
export function resolveTemplateLiteral(node: TemplateExpression, bindings: Map<string, string>): string {
  const head = node.getHead().getText().slice(1, -2); // strip ` and ${
  let resolved = head;

  for (const span of node.getTemplateSpans()) {
    const spanExpr = span.getExpression();
    const varName = Node.isIdentifier(spanExpr) ? spanExpr.getText() : '';
    const value = bindings.get(varName) ?? `\${${varName}}`;
    const literal = span.getLiteral().getText();
    // TemplateMiddle: text between } and ${ -> strip leading } and trailing ${
    // TemplateTail: text between } and ` -> strip leading } and trailing `
    const tailText = literal.slice(1, literal.endsWith('`') ? -1 : -2);
    resolved += value + tailText;
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Printf-style template resolution
// ---------------------------------------------------------------------------

/**
 * Resolve Vitest/Jest printf-style substitution patterns used by
 * `test.each` and `describe.each`.
 *
 * Handles: %s (string), %i/%d (integer), %f (float), %j (JSON),
 * %p (pretty-format), %% (literal percent).
 */
export function resolvePrintfTemplate(template: string, args: string[]): string {
  let argIndex = 0;
  return template.replace(/%%|%[sidfjp]/g, match => {
    if (match === '%%') return '%';
    if (argIndex >= args.length) return match;
    return args[argIndex++];
  });
}

// ---------------------------------------------------------------------------
// Boundary confidence
// ---------------------------------------------------------------------------

/**
 * Returns 'low' when `value` is within 20% of any threshold boundary.
 * Used by interpreters to flag assessments near decision boundaries.
 */
export function computeBoundaryConfidence(value: number, thresholds: number[]): 'high' | 'low' {
  for (const threshold of thresholds) {
    if (threshold === 0) continue;
    const distance = Math.abs(value - threshold) / threshold;
    if (distance <= 0.2) return 'low';
  }
  return 'high';
}
