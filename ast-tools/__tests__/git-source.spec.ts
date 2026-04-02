import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  gitShowFile,
  gitGetHeadContent,
  gitListFiles,
  createVirtualProject,
  readFileFromGit,
  writeGitFileToTemp,
} from '../git-source';

describe('git-source', () => {
  // -----------------------------------------------------------------------
  // gitShowFile
  // -----------------------------------------------------------------------
  describe('gitShowFile', () => {
    it('reads a known file from HEAD', () => {
      const content = gitShowFile('HEAD', 'package.json');
      expect(content).not.toBeNull();
      expect(content).toContain('"name"');
    });

    it('returns null for nonexistent file', () => {
      expect(gitShowFile('HEAD', 'does-not-exist-xyz.ts')).toBeNull();
    });

    it('returns null for nonexistent branch', () => {
      expect(gitShowFile('nonexistent-branch-xyz-12345', 'package.json')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // gitGetHeadContent
  // -----------------------------------------------------------------------
  describe('gitGetHeadContent', () => {
    it('reads a known file from HEAD', () => {
      const content = gitGetHeadContent('package.json');
      expect(content).not.toBeNull();
      expect(content).toContain('"name"');
    });

    it('returns null for a nonexistent file', () => {
      expect(gitGetHeadContent('this-file-does-not-exist-anywhere.xyz')).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // gitListFiles
  // -----------------------------------------------------------------------
  describe('gitListFiles', () => {
    it('lists files in a directory', () => {
      const files = gitListFiles('HEAD', 'scripts/AST/');
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.includes('.ts'))).toBe(true);
    });

    it('appends trailing slash if missing', () => {
      const files = gitListFiles('HEAD', 'scripts/AST');
      expect(files.length).toBeGreaterThan(0);
    });

    it('filters by glob pattern', () => {
      const files = gitListFiles('HEAD', 'scripts/AST/', '*.ts');
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(f).toMatch(/\.ts$/);
      }
    });

    it('returns empty for nonexistent directory', () => {
      expect(gitListFiles('HEAD', 'nonexistent-dir-xyz/')).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // createVirtualProject
  // -----------------------------------------------------------------------
  describe('createVirtualProject', () => {
    it('produces a working Project that can parse TypeScript', () => {
      const project = createVirtualProject();
      const sf = project.createSourceFile('__test_virtual__.ts', 'const x: number = 42;');
      const vars = sf.getVariableDeclarations();
      expect(vars.length).toBe(1);
      expect(vars[0].getName()).toBe('x');
    });

    it('produces a Project that can parse JSX', () => {
      const project = createVirtualProject();
      const sf = project.createSourceFile('__test_virtual__.tsx', 'const Foo = () => <div>hello</div>;');
      const vars = sf.getVariableDeclarations();
      expect(vars.length).toBe(1);
      expect(vars[0].getName()).toBe('Foo');
    });
  });

  // -----------------------------------------------------------------------
  // readFileFromGit
  // -----------------------------------------------------------------------
  describe('readFileFromGit', () => {
    it('reads a known file', () => {
      const content = readFileFromGit('HEAD', 'package.json');
      expect(content).toContain('"name"');
    });

    it('throws for nonexistent file', () => {
      expect(() => readFileFromGit('HEAD', 'does-not-exist-xyz.ts')).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // writeGitFileToTemp
  // -----------------------------------------------------------------------
  describe('writeGitFileToTemp', () => {
    it('writes git content to temp file', () => {
      const tmpPath = writeGitFileToTemp('HEAD', 'package.json');
      try {
        expect(fs.existsSync(tmpPath)).toBe(true);
        const content = fs.readFileSync(tmpPath, 'utf-8');
        expect(content).toContain('"name"');
        expect(path.extname(tmpPath)).toBe('.json');
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });
  });
});
