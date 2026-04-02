import { describe, it, expect, vi } from 'vitest';
import { parseArgs, output, outputFiltered } from '../cli';

describe('cli', () => {
  describe('parseArgs', () => {
    it('extracts file paths from positional arguments', () => {
      const result = parseArgs(['node', 'script.ts', 'src/foo.ts', 'src/bar.tsx']);
      expect(result.paths).toEqual(['src/foo.ts', 'src/bar.tsx']);
    });

    it('sets pretty flag when --pretty is passed', () => {
      const result = parseArgs(['node', 'script.ts', '--pretty', 'src/foo.ts']);
      expect(result.pretty).toBe(true);
      expect(result.paths).toEqual(['src/foo.ts']);
    });

    it('sets help flag when --help is passed', () => {
      const result = parseArgs(['node', 'script.ts', '--help']);
      expect(result.help).toBe(true);
    });

    it('defaults pretty and help to false', () => {
      const result = parseArgs(['node', 'script.ts', 'src/foo.ts']);
      expect(result.pretty).toBe(false);
      expect(result.help).toBe(false);
    });

    it('handles no arguments beyond node and script', () => {
      const result = parseArgs(['node', 'script.ts']);
      expect(result.paths).toEqual([]);
      expect(result.pretty).toBe(false);
      expect(result.help).toBe(false);
    });

    it('expands a glob pattern to matching files using fast-glob', () => {
      // Passing a pattern with * triggers the fg.sync branch (line 83)
      const result = parseArgs(['node', 'script.ts', 'scripts/AST/__tests__/cli.spec.ts']);
      expect(result.paths).toContain('scripts/AST/__tests__/cli.spec.ts');

      // Pattern with glob characters -- should resolve to at least cli.ts itself
      const globResult = parseArgs(['node', 'script.ts', 'scripts/AST/cl*.ts']);
      expect(globResult.paths.length).toBeGreaterThan(0);
      expect(globResult.paths.some(p => p.includes('cli.ts'))).toBe(true);
    });
  });

  describe('output', () => {
    it('writes compact JSON to stdout when pretty is false', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const data = { foo: 'bar', count: 42 };

      output(data, false);

      expect(writeSpy).toHaveBeenCalledWith('{"foo":"bar","count":42}\n');
      writeSpy.mockRestore();
    });

    it('writes indented JSON to stdout when pretty is true', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const data = { foo: 'bar' };

      output(data, true);

      const expected = JSON.stringify(data, null, 2) + '\n';
      expect(writeSpy).toHaveBeenCalledWith(expected);
      writeSpy.mockRestore();
    });
  });

  describe('outputFiltered', () => {
    it('filters an array result by kind (line 147 branch)', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const data = [
        { observations: [{ kind: 'AS_ANY_CAST' }, { kind: 'NON_NULL_ASSERTION' }] },
        { observations: [{ kind: 'AS_ANY_CAST' }] },
      ];

      outputFiltered(data, false, { kind: 'AS_ANY_CAST' });

      const written = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written) as { observations: { kind: string }[] }[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0].observations).toHaveLength(1);
      expect(parsed[0].observations[0].kind).toBe('AS_ANY_CAST');
      expect(parsed[1].observations).toHaveLength(1);
      writeSpy.mockRestore();
    });

    it('filters a single object result by kind (non-array branch)', () => {
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const data = { observations: [{ kind: 'AS_ANY_CAST' }, { kind: 'NON_NULL_ASSERTION' }] };

      outputFiltered(data, false, { kind: 'AS_ANY_CAST' });

      const written = writeSpy.mock.calls[0][0] as string;
      const parsed = JSON.parse(written) as { observations: { kind: string }[] };
      expect(parsed.observations).toHaveLength(1);
      expect(parsed.observations[0].kind).toBe('AS_ANY_CAST');
      writeSpy.mockRestore();
    });
  });
});
