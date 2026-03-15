import { describe, it, expect, vi } from 'vitest';
import { parseArgs, output } from '../cli';

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
});
