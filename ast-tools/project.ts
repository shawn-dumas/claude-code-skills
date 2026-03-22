import { Project, type SourceFile } from 'ts-morph';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

/**
 * Root directory of the project being analyzed.
 *
 * Resolution order:
 *   1. `AST_PROJECT_ROOT` env var (for standalone/external use)
 *   2. Relative to this file: `../../` (for in-repo use at scripts/AST/)
 *
 * Standalone users set the env var to point at their repo before running tools.
 */
export const PROJECT_ROOT = process.env.AST_PROJECT_ROOT
  ? path.resolve(process.env.AST_PROJECT_ROOT)
  : path.resolve(currentDirPath, '../..');

let cachedProject: Project | null = null;

export function getProject(): Project {
  if (cachedProject) return cachedProject;
  cachedProject = new Project({
    tsConfigFilePath: path.join(PROJECT_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
  });
  return cachedProject;
}

export function getSourceFile(filePath: string): SourceFile {
  const project = getProject();
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const sf = project.getSourceFile(absolute);
  if (sf) return sf;
  return project.addSourceFileAtPath(absolute);
}

/**
 * Find files that import from the given file path using a fast ripgrep
 * pre-pass, then return only those candidate paths.
 *
 * This is the hybrid approach: rg for speed, AST for accuracy. Loading
 * all of src/ into ts-morph on every invocation would be slow (~2-3s
 * for this codebase). The rg pass is <100ms and narrows to ~5-20 files.
 */
export function findConsumerFiles(targetPath: string, searchDir = path.join(PROJECT_ROOT, 'src')): string[] {
  const basename = path.basename(targetPath, path.extname(targetPath));
  const dirName = path.basename(path.dirname(targetPath));

  const isIndex = basename === 'index';
  const importTarget = isIndex ? dirName : basename;

  try {
    const result = execFileSync(
      'rg',
      ['-l', '--fixed-strings', '--type-add', 'tsx:*.tsx', '--type', 'ts', '--type', 'tsx', importTarget, searchDir],
      { encoding: 'utf-8', cwd: PROJECT_ROOT, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return result
      .split('\n')
      .filter((line: string) => Boolean(line))
      .map((f: string) => path.resolve(PROJECT_ROOT, f))
      .filter((f: string) => f !== targetPath);
  } catch (error: unknown) {
    // rg exits with code 1 when no matches are found -- that's expected, not an error
    const isNoMatchExit =
      error !== null && typeof error === 'object' && 'status' in error && (error as { status: number }).status === 1;
    if (!isNoMatchExit) {
      console.error(
        `[ast] findConsumerFiles: rg failed for ${importTarget}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return [];
  }
}
