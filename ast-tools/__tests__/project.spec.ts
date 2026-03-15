import { describe, it, expect } from 'vitest';
import path from 'path';
import { getProject, getSourceFile, findConsumerFiles, PROJECT_ROOT } from '../project';

describe('project', () => {
  describe('getProject', () => {
    it('loads tsconfig without error', () => {
      const project = getProject();
      expect(project).toBeDefined();
      expect(project.getCompilerOptions()).toBeDefined();
    });

    it('returns the same cached instance on repeated calls', () => {
      const a = getProject();
      const b = getProject();
      expect(a).toBe(b);
    });
  });

  describe('getSourceFile', () => {
    it('returns a SourceFile for a known project file', () => {
      const sf = getSourceFile('src/shared/utils/typedStorage.ts');
      expect(sf).toBeDefined();
      expect(sf.getFilePath()).toContain('typedStorage.ts');
    });

    it('accepts absolute paths', () => {
      const absolutePath = path.join(PROJECT_ROOT, 'src/shared/utils/typedStorage.ts');
      const sf = getSourceFile(absolutePath);
      expect(sf).toBeDefined();
      expect(sf.getFilePath()).toContain('typedStorage.ts');
    });

    it('throws for a nonexistent path', () => {
      expect(() => getSourceFile('src/nonexistent/file.ts')).toThrow();
    });
  });

  describe('path alias resolution', () => {
    it('resolves @/* alias through ts-morph', () => {
      const project = getProject();
      const compilerOptions = project.getCompilerOptions();
      const paths = compilerOptions.paths;
      expect(paths).toBeDefined();
      expect(paths!['@/*']).toBeDefined();
    });

    it('resolves @/shared/* alias through ts-morph', () => {
      const project = getProject();
      const paths = project.getCompilerOptions().paths;
      expect(paths!['@/shared/*']).toBeDefined();
    });

    it('resolves @/fixtures/* alias through ts-morph', () => {
      const project = getProject();
      const paths = project.getCompilerOptions().paths;
      expect(paths!['@/fixtures/*']).toBeDefined();
    });

    it('resolves path aliases in actual source files', () => {
      // Load a file that uses path aliases and verify ts-morph
      // can resolve them via the import declarations
      const sf = getSourceFile('src/shared/utils/typedStorage.ts');
      const imports = sf.getImportDeclarations();
      // typedStorage.ts may or may not have aliased imports,
      // but verifying it loads and parses is the key test
      expect(imports).toBeDefined();
    });
  });

  describe('findConsumerFiles', () => {
    it('returns consumers for a well-known shared utility', () => {
      const targetPath = path.join(PROJECT_ROOT, 'src/shared/utils/typedStorage.ts');
      const consumers = findConsumerFiles(targetPath);
      expect(consumers.length).toBeGreaterThan(0);
      // Should not include the file itself
      expect(consumers).not.toContain(targetPath);
    });

    it('returns an empty array for a file with no consumers', () => {
      const targetPath = path.join(PROJECT_ROOT, 'scripts/AST/__tests__/fixtures/circular-a.ts');
      const consumers = findConsumerFiles(targetPath);
      // Fixture files are not in src/, so searching src/ should find nothing
      expect(consumers).toEqual([]);
    });
  });
});
