import { describe, it, expect } from 'vitest';
import { gitGetHeadContent, createVirtualProject } from '../git-source';

describe('git-source', () => {
  describe('gitGetHeadContent', () => {
    it('reads a known file from HEAD', () => {
      const content = gitGetHeadContent('package.json');
      expect(content).not.toBeNull();
      expect(content).toContain('"name"');
    });

    it('returns null for a nonexistent file', () => {
      const content = gitGetHeadContent('this-file-does-not-exist-anywhere.xyz');
      expect(content).toBeNull();
    });
  });

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
});
