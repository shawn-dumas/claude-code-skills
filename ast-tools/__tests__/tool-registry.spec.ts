import { describe, it, expect } from 'vitest';
import path from 'path';
import { getToolNames, runObservers, TOOL_REGISTRY } from '../tool-registry';
import { getSourceFile, PROJECT_ROOT } from '../project';

describe('tool-registry', () => {
  describe('getToolNames', () => {
    it('returns all 13 tool names', () => {
      const names = getToolNames();
      expect(names).toHaveLength(13);
      expect(names).toContain('complexity');
      expect(names).toContain('data-layer');
      expect(names).toContain('env-access');
      expect(names).toContain('feature-flags');
      expect(names).toContain('imports');
      expect(names).toContain('jsx-analysis');
      expect(names).toContain('react-inventory');
      expect(names).toContain('side-effects');
      expect(names).toContain('storage-access');
      expect(names).toContain('test-analysis');
      expect(names).toContain('pw-test-parity');
      expect(names).toContain('vitest-parity');
      expect(names).toContain('type-safety');
    });
  });

  describe('TOOL_REGISTRY', () => {
    it('has an entry for each tool name', () => {
      const names = getToolNames();
      for (const name of names) {
        expect(TOOL_REGISTRY.has(name)).toBe(true);
        const entry = TOOL_REGISTRY.get(name)!;
        expect(entry.name).toBe(name);
        expect(typeof entry.analyze).toBe('function');
      }
    });
  });

  describe('runObservers', () => {
    it('runs a single tool on a simple file', () => {
      const filePath = path.join(PROJECT_ROOT, 'scripts/AST/shared.ts');
      const sf = getSourceFile(filePath);
      const observations = runObservers(sf, filePath, ['complexity']);
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every(o => o.kind === 'FUNCTION_COMPLEXITY')).toBe(true);
    });

    it('throws for an unknown tool name', () => {
      const filePath = path.join(PROJECT_ROOT, 'scripts/AST/shared.ts');
      const sf = getSourceFile(filePath);
      expect(() => runObservers(sf, filePath, ['nonexistent-tool'])).toThrowError(
        /Unknown tool name: 'nonexistent-tool'/,
      );
    });

    it('returns observations from multiple tools', () => {
      const filePath = path.join(PROJECT_ROOT, 'scripts/AST/shared.ts');
      const sf = getSourceFile(filePath);
      const observations = runObservers(sf, filePath, ['complexity', 'side-effects', 'env-access']);
      const kinds = new Set(observations.map(o => o.kind));
      expect(kinds.has('FUNCTION_COMPLEXITY')).toBe(true);
    });
  });
});
