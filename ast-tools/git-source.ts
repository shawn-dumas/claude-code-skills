/**
 * Git source reading utilities for AST tools.
 *
 * Extracted from ast-test-parity.ts to enable reuse across tools.
 * Provides functions to read files and list directories from any git ref,
 * plus a virtual ts-morph Project factory for parsing non-tsconfig content.
 */

import { execFileSync } from 'child_process';
import { Project } from 'ts-morph';
import { PROJECT_ROOT } from './project';

/**
 * Read a file from any git ref via `git show <ref>:<path>`.
 * Returns null if the file does not exist at that ref.
 */
export function gitShowFile(branch: string, filePath: string): string | null {
  try {
    return execFileSync('git', ['show', `${branch}:${filePath}`], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      maxBuffer: 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null;
  }
}

/**
 * List files at a git ref via `git ls-tree --name-only -r`.
 * Optional glob pattern filters results by extension or name.
 */
export function gitListFiles(branch: string, dirPath: string, pattern?: string): string[] {
  try {
    const normalized = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const result = execFileSync('git', ['ls-tree', '--name-only', '-r', `${branch}:${normalized}`], {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const files = result.split('\n').filter(Boolean);
    if (!pattern) return files;

    const regex = globToRegex(pattern);
    return files.filter(f => regex.test(f));
  } catch {
    return [];
  }
}

/**
 * Convenience wrapper: read a file from HEAD.
 */
export function gitGetHeadContent(filePath: string): string | null {
  return gitShowFile('HEAD', filePath);
}

/**
 * Create a ts-morph Project that does not inherit from tsconfig.
 * Useful for parsing virtual files from git refs or cross-file factories.
 */
export function createVirtualProject(): Project {
  return new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      target: 99,
      module: 99,
      jsx: 4,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
    },
  });
}

/**
 * Convert a simple glob pattern to a regex.
 * Supports `*` (any chars except /) and `**` (any chars including /).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*');
  return new RegExp(`^${escaped}$`);
}
