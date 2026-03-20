import { describe, it, expect } from 'vitest';
import path from 'path';
import { getToolNames, runObservers, TOOL_REGISTRY } from '../tool-registry';
import { getSourceFile, PROJECT_ROOT } from '../project';

describe('tool-registry', () => {
  describe('getToolNames', () => {
    it('returns a non-empty list of registered tool names', () => {
      const names = getToolNames();
      expect(names.length).toBeGreaterThan(0);
      // Every name should be a non-empty string
      for (const name of names) {
        expect(typeof name).toBe('string');
        expect(name.length).toBeGreaterThan(0);
      }
    });

    it('includes known tool names', () => {
      const names = getToolNames();
      // Spot-check a few tools across different domains to catch registry wiring issues.
      // This list is intentionally not exhaustive -- new tools do not need to be added here.
      expect(names).toContain('complexity');
      expect(names).toContain('imports');
      expect(names).toContain('react-inventory');
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
