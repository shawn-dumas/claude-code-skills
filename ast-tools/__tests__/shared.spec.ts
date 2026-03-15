import { describe, it, expect } from 'vitest';
import { Project, SyntaxKind } from 'ts-morph';
import { resolveCallName, resolveTemplateLiteral, resolvePrintfTemplate, computeBoundaryConfidence } from '../shared';

function createProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { target: 99, module: 99, jsx: 4 },
  });
}

describe('shared utilities', () => {
  describe('resolveCallName', () => {
    const project = createProject();

    it('resolves simple identifier call', () => {
      const sf = project.createSourceFile('__resolve_simple__.ts', 'describe("test", () => {});', {
        overwrite: true,
      });
      const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
      expect(resolveCallName(calls[0])).toBe('describe');
    });

    it('resolves property access call (test.describe)', () => {
      const sf = project.createSourceFile('__resolve_prop__.ts', 'test.describe("test", () => {});', {
        overwrite: true,
      });
      const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
      expect(resolveCallName(calls[0])).toBe('describe');
    });

    it('resolves chained property access (test.describe.configure)', () => {
      const sf = project.createSourceFile('__resolve_chain__.ts', "test.describe.configure({ mode: 'serial' });", {
        overwrite: true,
      });
      const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
      expect(resolveCallName(calls[0])).toBe('configure');
    });

    it('resolves namespaced call (React.memo)', () => {
      const sf = project.createSourceFile('__resolve_memo__.tsx', 'const Foo = React.memo(() => <div />);', {
        overwrite: true,
      });
      const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression);
      expect(resolveCallName(calls[0])).toBe('memo');
    });

    it('returns empty string for non-call-expression nodes', () => {
      const sf = project.createSourceFile('__resolve_noncall__.ts', 'const x = 42;', {
        overwrite: true,
      });
      const varDecl = sf.getVariableDeclarations()[0];
      expect(resolveCallName(varDecl)).toBe('');
    });
  });

  describe('resolveTemplateLiteral', () => {
    const project = createProject();

    it('resolves template with known bindings', () => {
      const sf = project.createSourceFile('__tpl_known__.ts', 'const name = "x"; const x = `hello ${name} world`;', {
        overwrite: true,
      });
      const tpls = sf.getDescendantsOfKind(SyntaxKind.TemplateExpression);
      expect(tpls.length).toBeGreaterThan(0);
      const bindings = new Map([['name', 'Alice']]);
      expect(resolveTemplateLiteral(tpls[0], bindings)).toBe('hello Alice world');
    });

    it('resolves template with unknown bindings', () => {
      const sf = project.createSourceFile(
        '__tpl_unknown__.ts',
        'const unknown = "x"; const x = `hello ${unknown} world`;',
        { overwrite: true },
      );
      const tpls = sf.getDescendantsOfKind(SyntaxKind.TemplateExpression);
      const bindings = new Map<string, string>();
      expect(resolveTemplateLiteral(tpls[0], bindings)).toBe('hello ${unknown} world');
    });

    it('resolves template with mixed bindings', () => {
      const sf = project.createSourceFile(
        '__tpl_mixed__.ts',
        'const greeting = "x"; const name = "y"; const x = `${greeting} ${name}!`;',
        { overwrite: true },
      );
      const tpls = sf.getDescendantsOfKind(SyntaxKind.TemplateExpression);
      const bindings = new Map([['greeting', 'Hi']]);
      expect(resolveTemplateLiteral(tpls[0], bindings)).toBe('Hi ${name}!');
    });
  });

  describe('resolvePrintfTemplate', () => {
    it('resolves %s placeholders', () => {
      expect(resolvePrintfTemplate('hello %s world', ['Alice'])).toBe('hello Alice world');
    });

    it('resolves %i and %d placeholders', () => {
      expect(resolvePrintfTemplate('count: %i, total: %d', ['5', '10'])).toBe('count: 5, total: 10');
    });

    it('resolves %f placeholder', () => {
      expect(resolvePrintfTemplate('value: %f', ['3.14'])).toBe('value: 3.14');
    });

    it('resolves %j placeholder (JSON)', () => {
      expect(resolvePrintfTemplate('data: %j', ['{"a":1}'])).toBe('data: {"a":1}');
    });

    it('resolves %% as literal percent', () => {
      expect(resolvePrintfTemplate('100%% done', [])).toBe('100% done');
    });

    it('preserves unmatched placeholders when args exhausted', () => {
      expect(resolvePrintfTemplate('%s and %s', ['first'])).toBe('first and %s');
    });

    it('handles multiple mixed placeholders', () => {
      expect(resolvePrintfTemplate('%s has %d items (%f%%)', ['list', '3', '75.5'])).toBe('list has 3 items (75.5%)');
    });

    it('handles %p (pretty-format)', () => {
      expect(resolvePrintfTemplate('value: %p', ['test'])).toBe('value: test');
    });

    it('handles empty template', () => {
      expect(resolvePrintfTemplate('', [])).toBe('');
    });
  });

  describe('computeBoundaryConfidence', () => {
    it('returns high when value is far from all thresholds', () => {
      expect(computeBoundaryConfidence(10, [3, 20])).toBe('high');
    });

    it('returns low when value is within 20% of a threshold', () => {
      expect(computeBoundaryConfidence(5, [5])).toBe('low');
    });

    it('returns low when value is near threshold boundary', () => {
      expect(computeBoundaryConfidence(4.5, [5])).toBe('low');
    });

    it('returns high when value is beyond 20% of thresholds', () => {
      expect(computeBoundaryConfidence(3, [5])).toBe('high');
    });

    it('skips zero thresholds', () => {
      expect(computeBoundaryConfidence(0, [0, 10])).toBe('high');
    });

    it('checks all thresholds and returns low if any is near', () => {
      expect(computeBoundaryConfidence(9, [3, 10, 20])).toBe('low');
    });
  });
});
