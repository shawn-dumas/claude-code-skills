/**
 * Shared utilities for AST tools. Extracted to avoid duplication across tools.
 *
 * - truncateText, getContainingFunctionName: common helpers used by most tools
 * - getFilesInDirectory: recursive TS/TSX file discovery with consistent exclusions
 * - isPascalCase, containsJsx, getBody, detectComponents: component detection
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

export interface DetectedComponent {
  name: string;
  funcNode: Node;
}

/**
 * Detect React components in a source file. Returns a minimal list with name
 * and function node. Tools that need richer metadata (line numbers, kind,
 * wrapper call info) should extend this result locally.
 */
export function detectComponents(sf: SourceFile): DetectedComponent[] {
  const components: DetectedComponent[] = [];

  // 1. Function declarations: export function Foo(...) { ... }
  for (const func of sf.getFunctions()) {
    const name = func.getName();
    if (!name || !isPascalCase(name)) continue;
    if (containsJsx(func)) {
      components.push({ name, funcNode: func });
    }
  }

  // 2. Variable declarations: const Foo = () => ... | memo(...) | forwardRef(...)
  for (const varStmt of sf.getVariableStatements()) {
    for (const decl of varStmt.getDeclarationList().getDeclarations()) {
      const name = decl.getName();
      if (!isPascalCase(name)) continue;

      const init = decl.getInitializer();
      if (!init) continue;

      // Arrow function or function expression
      if (Node.isArrowFunction(init) || Node.isFunctionExpression(init)) {
        if (containsJsx(init)) {
          components.push({ name, funcNode: init });
        }
        continue;
      }

      // memo() / forwardRef() wrappers
      if (Node.isCallExpression(init)) {
        const callee = init.getExpression().getText();
        if (callee === 'memo' || callee === 'React.memo' || callee === 'forwardRef' || callee === 'React.forwardRef') {
          const args = init.getArguments();
          if (args.length > 0) {
            const inner = args[0];
            if ((Node.isArrowFunction(inner) || Node.isFunctionExpression(inner)) && containsJsx(inner)) {
              components.push({ name, funcNode: inner });
            }
          }
        }
      }
    }
  }

  // 3. Non-exported inner function declarations (PascalCase, returns JSX)
  sf.forEachDescendant(node => {
    if (!Node.isFunctionDeclaration(node)) return;
    const name = node.getName();
    if (!name || !isPascalCase(name)) return;
    if (components.some(c => c.name === name)) return;
    if (containsJsx(node)) {
      components.push({ name, funcNode: node });
    }
  });

  return components;
}
