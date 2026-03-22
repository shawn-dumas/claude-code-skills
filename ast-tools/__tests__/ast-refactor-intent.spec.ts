import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import type { AnyObservation, RefactorSignalPair } from '../types';
import { PROJECT_ROOT } from '../project';

// Loose-typed alias for monkey-patching fs in tests (avoids overload mismatch errors)
const fsAny = fs as unknown as Record<string, unknown>;

// Mock git-source to avoid depending on actual git state
vi.mock('../git-source', () => ({
  gitGetHeadContent: vi.fn(),
  createVirtualProject: vi.fn(),
}));

// Mock tool-registry to control observations
vi.mock('../tool-registry', () => ({
  runAllObservers: vi.fn(),
}));

import { gitGetHeadContent, createVirtualProject } from '../git-source';
import { runAllObservers } from '../tool-registry';

// Dynamically import after mocks are set up
const { analyzeRefactorIntent, prettyPrint } = await import('../ast-refactor-intent');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** Compute relative path from project root, matching production code behavior. */
function relFromRoot(filePath: string): string {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  return path.relative(PROJECT_ROOT, absolute);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(
  kind: string,
  file: string,
  line: number,
  evidence: Record<string, unknown> = {},
): AnyObservation {
  return { kind, file, line, evidence } as AnyObservation;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ast-refactor-intent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeRefactorIntent', () => {
    it('matches same hooks in different order', () => {
      const file = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');
      const relativePath = relFromRoot(file);

      const beforeObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 16, { hookName: 'useMemo', parentFunction: 'Dashboard' }),
      ];

      // Same hooks but reordered
      const afterObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 16, { hookName: 'useMemo', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
      ];

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      let callIdx = 0;
      vi.mocked(runAllObservers).mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? [...beforeObs] : [...afterObs];
      });

      // Mock fs.existsSync and fs.readFileSync for the after file
      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (p.includes('refactor-intent-before')) return '// after content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        const result = analyzeRefactorIntent([file], [file]);
        expect(result.matched.length).toBe(3);
        expect(result.unmatched.length).toBe(0);
        expect(result.novel.length).toBe(0);

        // Each match should have similarity > 0
        for (const m of result.matched) {
          expect(m.similarity).toBeGreaterThan(0);
        }
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('handles file split: component + hook split into two files', () => {
      const beforeFile = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');
      const afterContainer = path.join(FIXTURES_DIR, 'refactor-intent-after-container.tsx');
      const afterBlock = path.join(FIXTURES_DIR, 'refactor-intent-after-block.tsx');
      const relBefore = relFromRoot(beforeFile);
      const relContainer = relFromRoot(afterContainer);
      const relBlock = relFromRoot(afterBlock);

      const beforeObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relBefore, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relBefore, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
        makeObservation('COMPONENT_DECLARATION', relBefore, 8, { componentName: 'Dashboard', kind: 'function' }),
      ];

      const afterContainerObs: AnyObservation[] = [
        // Same parentFunction name to test cross-file matching
        makeObservation('HOOK_CALL', relContainer, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relContainer, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
        makeObservation('COMPONENT_DECLARATION', relContainer, 8, {
          componentName: 'DashboardContainer',
          kind: 'function',
        }),
      ];

      const afterBlockObs: AnyObservation[] = [
        makeObservation('COMPONENT_DECLARATION', relBlock, 5, { componentName: 'DashboardBlock', kind: 'function' }),
      ];

      // gitGetHeadContent: before file has HEAD content, after files are new
      vi.mocked(gitGetHeadContent).mockImplementation((fp: string) => {
        if (fp === relBefore) return '// before content';
        return null;
      });

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      // Track calls to runAllObservers and return appropriate observations
      // Call order: 1=before(HEAD), 2=after(container), 3=after(block)
      let callIdx = 0;
      vi.mocked(runAllObservers).mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) return [...beforeObs];
        if (callIdx === 2) return [...afterContainerObs];
        return [...afterBlockObs];
      });

      // Mock fs: before file does not exist on disk (it was split),
      // after files exist on disk
      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-after-container')) return true;
        if (typeof p === 'string' && p.includes('refactor-intent-after-block')) return true;
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return false;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-after-container')) return '// container content';
        if (typeof p === 'string' && p.includes('refactor-intent-after-block')) return '// block content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        const result = analyzeRefactorIntent([beforeFile], [afterContainer, afterBlock]);

        // Hooks match across file boundaries (file-agnostic matching)
        // useState matches useState, useEffect matches useEffect (same kind + same hookName)
        expect(result.matched.length).toBeGreaterThanOrEqual(2);
        // DashboardBlock is novel (new component with no match in before)
        expect(result.novel.length).toBeGreaterThanOrEqual(1);
        // Total: all before obs are either matched or unmatched
        expect(result.unmatched.length + result.matched.length).toBe(beforeObs.length);
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('detects dropped signal: useEffect removed', () => {
      const file = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');
      const relativePath = relFromRoot(file);

      const beforeObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
      ];

      // useEffect removed
      const afterObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
      ];

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      let callIdx = 0;
      vi.mocked(runAllObservers).mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? [...beforeObs] : [...afterObs];
      });

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (p.includes('refactor-intent-before')) return '// modified content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        const result = analyzeRefactorIntent([file], [file]);

        expect(result.matched.length).toBe(1);
        expect(result.matched[0].before.evidence).toEqual(expect.objectContaining({ hookName: 'useState' }));
        expect(result.unmatched.length).toBe(1);
        expect(result.unmatched[0].evidence).toEqual(expect.objectContaining({ hookName: 'useEffect' }));
        expect(result.novel.length).toBe(0);
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('detects added signal: new useMemo', () => {
      const file = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');
      const relativePath = relFromRoot(file);

      const beforeObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
      ];

      // useMemo added
      const afterObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relativePath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relativePath, 14, { hookName: 'useMemo', parentFunction: 'Dashboard' }),
      ];

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      let callIdx = 0;
      vi.mocked(runAllObservers).mockImplementation(() => {
        callIdx++;
        return callIdx === 1 ? [...beforeObs] : [...afterObs];
      });

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (p.includes('refactor-intent-before')) return '// modified content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        const result = analyzeRefactorIntent([file], [file]);

        expect(result.matched.length).toBe(1);
        expect(result.novel.length).toBe(1);
        expect(result.novel[0].evidence).toEqual(expect.objectContaining({ hookName: 'useMemo' }));
        expect(result.unmatched.length).toBe(0);
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('handles new file: all observations are novel', () => {
      const newFile = path.join(FIXTURES_DIR, 'refactor-intent-after-block.tsx');
      const relPath = relFromRoot(newFile);

      const afterObs: AnyObservation[] = [
        makeObservation('COMPONENT_DECLARATION', relPath, 5, { componentName: 'DashboardBlock', kind: 'function' }),
        makeObservation('PROP_FIELD', relPath, 7, { propName: 'teamId', propType: 'string' }),
      ];

      // No HEAD version
      vi.mocked(gitGetHeadContent).mockReturnValue(null);

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      vi.mocked(runAllObservers).mockReturnValue([...afterObs]);

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (p.includes('refactor-intent-after-block')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (p.includes('refactor-intent-after-block')) return '// new file content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        const result = analyzeRefactorIntent([], [newFile]);

        expect(result.before.observations.length).toBe(0);
        expect(result.novel.length).toBe(2);
        expect(result.matched.length).toBe(0);
        expect(result.unmatched.length).toBe(0);
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('handles deleted file: all observations are unmatched', () => {
      const deletedFile = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');
      const relPath = relFromRoot(deletedFile);

      const beforeObs: AnyObservation[] = [
        makeObservation('HOOK_CALL', relPath, 10, { hookName: 'useState', parentFunction: 'Dashboard' }),
        makeObservation('HOOK_CALL', relPath, 12, { hookName: 'useEffect', parentFunction: 'Dashboard' }),
      ];

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');

      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );

      vi.mocked(runAllObservers).mockReturnValue([...beforeObs]);

      const origExistsSync = fs.existsSync;
      fsAny.existsSync = (p: string) => {
        if (p.includes('refactor-intent-before')) return false;
        return origExistsSync(p);
      };

      try {
        // Before file exists in HEAD, after file does not exist on disk
        const result = analyzeRefactorIntent([deletedFile], [deletedFile]);

        expect(result.before.observations.length).toBe(2);
        expect(result.unmatched.length).toBe(2);
        expect(result.matched.length).toBe(0);
        expect(result.novel.length).toBe(0);
      } finally {
        fs.existsSync = origExistsSync;
      }
    });
  });

  describe('prettyPrint', () => {
    it('formats matched, unmatched, and novel sections', () => {
      const result: RefactorSignalPair = {
        before: {
          files: ['src/before.tsx'],
          observations: [
            makeObservation('HOOK_CALL', 'src/before.tsx', 10, { hookName: 'useState', parentFunction: 'Comp' }),
            makeObservation('HOOK_CALL', 'src/before.tsx', 12, { hookName: 'useEffect', parentFunction: 'Comp' }),
          ],
        },
        after: {
          files: ['src/after.tsx'],
          observations: [
            makeObservation('HOOK_CALL', 'src/after.tsx', 10, { hookName: 'useState', parentFunction: 'Comp' }),
            makeObservation('HOOK_CALL', 'src/after.tsx', 14, { hookName: 'useMemo', parentFunction: 'Comp' }),
          ],
        },
        matched: [
          {
            before: makeObservation('HOOK_CALL', 'src/before.tsx', 10, {
              hookName: 'useState',
              parentFunction: 'Comp',
            }),
            after: makeObservation('HOOK_CALL', 'src/after.tsx', 10, { hookName: 'useState', parentFunction: 'Comp' }),
            similarity: 0.95,
          },
        ],
        unmatched: [
          makeObservation('HOOK_CALL', 'src/before.tsx', 12, { hookName: 'useEffect', parentFunction: 'Comp' }),
        ],
        novel: [makeObservation('HOOK_CALL', 'src/after.tsx', 14, { hookName: 'useMemo', parentFunction: 'Comp' })],
      };

      const output = prettyPrint(result);

      expect(output).toContain('REFACTOR INTENT OBSERVATION');
      expect(output).toContain('MATCHED (1)');
      expect(output).toContain('95%');
      expect(output).toContain('UNMATCHED (1)');
      expect(output).toContain('NOVEL (1)');
      expect(output).toContain('useEffect');
      expect(output).toContain('useMemo');
    });

    it('shows (none) for empty sections', () => {
      const result: RefactorSignalPair = {
        before: { files: [], observations: [] },
        after: { files: [], observations: [] },
        matched: [],
        unmatched: [],
        novel: [],
      };

      const output = prettyPrint(result);

      expect(output).toContain('MATCHED (0)');
      expect(output).toContain('(none)');
      expect(output).toContain('UNMATCHED (0)');
      expect(output).toContain('NOVEL (0)');
    });
  });
});
