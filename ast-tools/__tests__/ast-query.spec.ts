import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ROUTES,
  KNOWN_UNROUTABLE,
  ARG_REWRITE_QUERY_TYPES,
  validateRoutes,
  resolveDispatch,
  main,
  HELP_TEXT,
  SCRIPTS_AST_DIR,
} from '../ast-query';

describe('ast-query dispatcher', () => {
  describe('route validation', () => {
    it('every ROUTES tool maps to an existing ast-*.ts file', () => {
      for (const [queryType, route] of ROUTES) {
        const toolPath = path.join(SCRIPTS_AST_DIR, `${route.tool}.ts`);
        expect(fs.existsSync(toolPath), `ROUTES["${queryType}"]: ${route.tool}.ts not found`).toBe(true);
      }
    });

    it('every KNOWN_UNROUTABLE tool maps to an existing ast-*.ts file', () => {
      for (const [key] of KNOWN_UNROUTABLE) {
        const toolPath = path.join(SCRIPTS_AST_DIR, `ast-${key}.ts`);
        expect(fs.existsSync(toolPath), `KNOWN_UNROUTABLE["${key}"]: ast-${key}.ts not found`).toBe(true);
      }
    });

    it('validateRoutes() returns valid when all files exist', () => {
      const result = validateRoutes();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('help text', () => {
    it('includes all standard route query types', () => {
      for (const [queryType] of ROUTES) {
        expect(HELP_TEXT).toContain(queryType);
      }
    });

    it('includes arg-rewriting query types', () => {
      for (const queryType of ARG_REWRITE_QUERY_TYPES) {
        expect(HELP_TEXT).toContain(queryType);
      }
    });

    it('includes all known unroutable query types', () => {
      for (const [key] of KNOWN_UNROUTABLE) {
        expect(HELP_TEXT).toContain(key);
      }
    });
  });

  describe('route coverage', () => {
    it('arg-rewriting routes are not in ROUTES', () => {
      for (const queryType of ARG_REWRITE_QUERY_TYPES) {
        expect(ROUTES.has(queryType), `"${queryType}" should not be in ROUTES`).toBe(false);
      }
    });

    it('known unroutable keys are not in ROUTES', () => {
      for (const [key] of KNOWN_UNROUTABLE) {
        expect(ROUTES.has(key), `"${key}" should not be in ROUTES`).toBe(false);
      }
    });

    it('no overlap between ROUTES, ARG_REWRITE, and KNOWN_UNROUTABLE', () => {
      const routeKeys = new Set(ROUTES.keys());
      const unroutableKeys = new Set(KNOWN_UNROUTABLE.keys());

      for (const key of ARG_REWRITE_QUERY_TYPES) {
        expect(routeKeys.has(key), `"${key}" in both ROUTES and ARG_REWRITE`).toBe(false);
        expect(unroutableKeys.has(key), `"${key}" in both KNOWN_UNROUTABLE and ARG_REWRITE`).toBe(false);
      }

      for (const key of routeKeys) {
        expect(unroutableKeys.has(key), `"${key}" in both ROUTES and KNOWN_UNROUTABLE`).toBe(false);
      }
    });
  });

  describe('dispatch resolution', () => {
    it('standard route constructs correct tool and args', () => {
      const result = resolveDispatch('imports', ['src/shared/'], ['--pretty']);
      expect(result).toEqual({ tool: 'ast-imports', args: ['src/shared/', '--pretty'] });
    });

    it('standard route with preset flags prepends them before extra flags', () => {
      const result = resolveDispatch('dead-exports', ['src/'], ['--pretty']);
      expect(result).toEqual({
        tool: 'ast-imports',
        args: ['src/', '--kind', 'DEAD_EXPORT_CANDIDATE', '--pretty'],
      });
    });

    it('as-any route presets --kind AS_ANY_CAST', () => {
      const result = resolveDispatch('as-any', ['src/'], []);
      expect(result).toEqual({ tool: 'ast-type-safety', args: ['src/', '--kind', 'AS_ANY_CAST'] });
    });

    it('consumers rewrites to ast-imports --consumers', () => {
      const result = resolveDispatch('consumers', ['src/file.ts'], ['--pretty']);
      expect(result).toEqual({ tool: 'ast-imports', args: ['--consumers', 'src/file.ts', '--pretty'] });
    });

    it('symbol rewrites with symbol name before path', () => {
      const result = resolveDispatch('symbol', ['BadRequestError', 'src/'], ['--pretty']);
      expect(result).toEqual({
        tool: 'ast-imports',
        args: ['src/', '--symbol', 'BadRequestError', '--pretty'],
      });
    });

    it('symbol with multiple paths passes all paths', () => {
      const result = resolveDispatch('symbol', ['MyType', 'src/shared/', 'src/ui/'], []);
      expect(result).toEqual({
        tool: 'ast-imports',
        args: ['src/shared/', 'src/ui/', '--symbol', 'MyType'],
      });
    });

    it('unknown query type returns null', () => {
      const result = resolveDispatch('nonexistent', ['src/'], []);
      expect(result).toBeNull();
    });

    it('known unroutable query type returns null', () => {
      const result = resolveDispatch('bff-gaps', ['src/'], []);
      expect(result).toBeNull();
    });
  });

  describe('gap logging', () => {
    let tmpDir: string;
    let gapsFile: string;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-query-test-'));
      gapsFile = path.join(tmpDir, 'GAPS.md');
      fs.writeFileSync(gapsFile, '# Test GAPS\n');
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      stderrSpy.mockRestore();
    });

    it('main() appends to GAPS.md on unknown query type', () => {
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error('EXIT');
      }) as never;

      try {
        main(['node', 'ast-query.ts', 'nonexistent-type', 'src/'], gapsFile);
      } catch {
        // Expected EXIT throw
      } finally {
        process.exit = origExit;
      }

      expect(exitCode).toBe(1);
      const content = fs.readFileSync(gapsFile, 'utf-8');
      expect(content).toContain('nonexistent-type');
      expect(content).toContain('auto-logged by ast-query');
    });

    it('main() does NOT append to GAPS.md for known unroutable query', () => {
      const origExit = process.exit;
      let exitCode: number | undefined;
      process.exit = ((code: number) => {
        exitCode = code;
        throw new Error('EXIT');
      }) as never;

      try {
        main(['node', 'ast-query.ts', 'bff-gaps', 'src/'], gapsFile);
      } catch {
        // Expected EXIT throw
      } finally {
        process.exit = origExit;
      }

      expect(exitCode).toBe(0);
      const content = fs.readFileSync(gapsFile, 'utf-8');
      expect(content).not.toContain('bff-gaps');
    });
  });

  describe('flag passthrough', () => {
    it('standard route includes route flags and extra flags', () => {
      const route = ROUTES.get('dead-exports');
      expect(route).toBeDefined();
      expect(route!.flags).toEqual(['--kind', 'DEAD_EXPORT_CANDIDATE']);
    });

    it('date-summary route includes --summary flag', () => {
      const route = ROUTES.get('date-summary');
      expect(route).toBeDefined();
      expect(route!.flags).toEqual(['--summary']);
    });

    it('as-any route includes --kind AS_ANY_CAST', () => {
      const route = ROUTES.get('as-any');
      expect(route).toBeDefined();
      expect(route!.flags).toEqual(['--kind', 'AS_ANY_CAST']);
    });
  });

  describe('arg-rewriting routes', () => {
    it('consumers and symbol are the only arg-rewriting query types', () => {
      expect([...ARG_REWRITE_QUERY_TYPES].sort()).toEqual(['consumers', 'symbol']);
    });
  });
});
