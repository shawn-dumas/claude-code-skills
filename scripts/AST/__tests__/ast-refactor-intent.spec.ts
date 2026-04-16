import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
const { analyzeRefactorIntent, prettyPrint, main, parseBeforeAfter } = await import('../ast-refactor-intent');

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

  // ---------------------------------------------------------------------------
  // parseBeforeAfter
  // ---------------------------------------------------------------------------

  describe('parseBeforeAfter', () => {
    it('parses --before and --after flags', () => {
      const argv = ['node', 'ast-refactor-intent.ts', '--before', 'a.tsx', 'b.tsx', '--after', 'c.tsx'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      expect(beforePaths).toEqual(['a.tsx', 'b.tsx']);
      expect(afterPaths).toEqual(['c.tsx']);
    });

    it('parses --after before --before', () => {
      const argv = ['node', 'ast-refactor-intent.ts', '--after', 'c.tsx', '--before', 'a.tsx'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      expect(beforePaths).toEqual(['a.tsx']);
      expect(afterPaths).toEqual(['c.tsx']);
    });

    it('stops consuming paths when an unknown flag is encountered', () => {
      const argv = ['node', 'ast-refactor-intent.ts', '--before', 'a.tsx', '--unknown', 'b.tsx'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      // --unknown stops the --before collection; b.tsx is not consumed
      expect(beforePaths).toEqual(['a.tsx']);
      expect(afterPaths).toEqual([]);
    });

    it('uses legacy -- separator when no --before/--after flags present', () => {
      const argv = ['node', 'ast-refactor-intent.ts', 'before.tsx', '--', 'after.tsx'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      expect(beforePaths).toEqual(['before.tsx']);
      expect(afterPaths).toEqual(['after.tsx']);
    });

    it('legacy mode: same file for both sides when no separator', () => {
      const argv = ['node', 'ast-refactor-intent.ts', 'file.tsx'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      expect(beforePaths).toEqual(['file.tsx']);
      expect(afterPaths).toEqual(['file.tsx']);
    });

    it('legacy mode strips --pretty and --help from paths', () => {
      const argv = ['node', 'ast-refactor-intent.ts', '--pretty', 'file.tsx', '--help'];
      const { beforePaths, afterPaths } = parseBeforeAfter(argv);
      expect(beforePaths).toEqual(['file.tsx']);
      expect(afterPaths).toEqual(['file.tsx']);
    });
  });

  // ---------------------------------------------------------------------------
  // main() CLI
  // ---------------------------------------------------------------------------

  describe('main()', () => {
    let stdoutChunks: string[];
    let stderrChunks: string[];
    let originalArgv: string[];

    beforeEach(() => {
      stdoutChunks = [];
      stderrChunks = [];
      originalArgv = process.argv;
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stdoutChunks.push(String(chunk));
        return true;
      });
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
        stderrChunks.push(String(chunk));
        return true;
      });
      vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as never);
    });

    afterEach(() => {
      process.argv = originalArgv;
      vi.restoreAllMocks();
    });

    it('--help exits 0 and prints usage', () => {
      process.argv = ['node', 'ast-refactor-intent.ts', '--help'];
      expect(() => main()).toThrow('process.exit(0)');
      const out = stdoutChunks.join('');
      expect(out).toContain('Usage:');
      expect(out).toContain('--before');
      expect(out).toContain('--after');
    });

    it('exits 1 when no file paths provided', () => {
      process.argv = ['node', 'ast-refactor-intent.ts'];
      expect(() => main()).toThrow('process.exit(1)');
      expect(stderrChunks.join('')).toContain('No file paths provided');
    });

    it('outputs JSON result for valid fixture files', () => {
      const fixture = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');
      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );
      vi.mocked(runAllObservers).mockReturnValue([]);

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return '// content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        process.argv = ['node', 'ast-refactor-intent.ts', '--before', fixture, '--after', fixture];
        main();
        const result = JSON.parse(stdoutChunks.join('')) as Record<string, unknown>;
        expect(result).toHaveProperty('matched');
        expect(result).toHaveProperty('unmatched');
        expect(result).toHaveProperty('novel');
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('--pretty outputs human-readable format', () => {
      const fixture = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');

      vi.mocked(gitGetHeadContent).mockReturnValue('// head content');
      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );
      vi.mocked(runAllObservers).mockReturnValue([]);

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return '// content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        process.argv = ['node', 'ast-refactor-intent.ts', '--before', fixture, '--after', fixture, '--pretty'];
        main();
        const out = stdoutChunks.join('');
        expect(out).toContain('REFACTOR INTENT OBSERVATION');
        expect(out).toContain('MATCHED');
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });

    it('catches error in after-file observation collection and continues', () => {
      const fixture = path.join(FIXTURES_DIR, 'refactor-intent-before.tsx');

      vi.mocked(gitGetHeadContent).mockReturnValue(null);
      const mockProject = { createSourceFile: vi.fn().mockReturnValue({}) };
      vi.mocked(createVirtualProject).mockReturnValue(
        mockProject as unknown as ReturnType<typeof createVirtualProject>,
      );
      // First call succeeds (after-file), second throws
      let callCount = 0;
      vi.mocked(runAllObservers).mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('parse error');
        return [];
      });

      const origExistsSync = fs.existsSync;
      const origReadFileSync = fs.readFileSync;
      fsAny.existsSync = (p: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return true;
        return origExistsSync(p);
      };
      fsAny.readFileSync = (p: string, enc: string) => {
        if (typeof p === 'string' && p.includes('refactor-intent-before')) return '// content';
        return origReadFileSync(p as fs.PathOrFileDescriptor, enc as BufferEncoding);
      };

      try {
        process.argv = ['node', 'ast-refactor-intent.ts', '--after', fixture];
        // Should not throw -- errors are caught and written to stderr
        main();
        const result = JSON.parse(stdoutChunks.join('')) as Record<string, unknown>;
        expect(result).toHaveProperty('matched');
        // Warning written to stderr
        expect(stderrChunks.join('')).toContain('Warning:');
      } finally {
        fs.existsSync = origExistsSync;
        fs.readFileSync = origReadFileSync;
      }
    });
  });
});
