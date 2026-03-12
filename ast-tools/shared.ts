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
import { type SourceFile, type FunctionDeclaration, SyntaxKind, Node } from 'ts-morph';

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

export function getContainingFunctionName(node: Node): string {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current)) {
      return current.getName() ?? '<anonymous>';
    }
    if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      if (parent && Node.isPropertyAssignment(parent)) {
        const propName = parent.getName();
        // Skip past hook option callbacks (queryFn, onSuccess, etc.)
        if (HOOK_OPTION_PROPERTIES.has(propName)) {
          current = current.getParent();
          continue;
        }
        return propName;
      }
      if (Node.isFunctionExpression(current) && current.getName()) {
        return current.getName()!;
      }
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

/**
 * Recursively collect .ts/.tsx production files from a directory.
 * Skips node_modules, .next, dist, .spec.*, .test.*, and .d.ts files.
 */
export function getFilesInDirectory(dirPath: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...getFilesInDirectory(fullPath));
    } else if (
      entry.isFile() &&
      /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.spec.tsx') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx') &&
      !entry.name.endsWith('.d.ts')
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Component detection
// ---------------------------------------------------------------------------

export function isPascalCase(name: string): boolean {
  return /^[A-Z]/.test(name);
}

/**
 * Check whether a function node contains JSX in its body or has a JSX/ReactNode
 * return type annotation. The react-inventory version (richer) is used here --
 * it checks both return type annotations and body content.
 */
export function containsJsx(node: Node): boolean {
  // Check return type annotation
  if (Node.isFunctionDeclaration(node) || Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const returnType = (node as FunctionDeclaration).getReturnTypeNode?.();
    if (returnType) {
      const text = returnType.getText();
      if (text.includes('JSX') || text.includes('ReactNode') || text.includes('ReactElement')) {
        return true;
      }
    }
  }

  // Check for JSX in the body
  let found = false;
  node.forEachDescendant(child => {
    if (found) return;
    if (
      child.getKind() === SyntaxKind.JsxElement ||
      child.getKind() === SyntaxKind.JsxSelfClosingElement ||
      child.getKind() === SyntaxKind.JsxFragment
    ) {
      found = true;
    }
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
