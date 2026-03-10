import { Project, type SourceFile } from 'ts-morph';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);

export const PROJECT_ROOT = path.resolve(currentDirPath, '../..');

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
    const result = execSync(`rg -l --type-add 'tsx:*.tsx' --type ts --type tsx "${importTarget}" "${searchDir}"`, {
      encoding: 'utf-8',
      cwd: PROJECT_ROOT,
    });
    return result
      .split('\n')
      .filter((line: string) => Boolean(line))
      .map((f: string) => path.resolve(PROJECT_ROOT, f))
      .filter((f: string) => f !== targetPath);
  } catch {
    return [];
  }
}
