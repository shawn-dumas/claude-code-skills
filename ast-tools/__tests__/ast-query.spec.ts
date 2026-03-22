import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ROUTES,
  KNOWN_UNROUTABLE,
  ARG_REWRITE_QUERY_TYPES,
  validateRoutes,
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

  describe('gap logging', () => {
    let tmpDir: string;
    let gapsFile: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ast-query-test-'));
      gapsFile = path.join(tmpDir, 'GAPS.md');
      fs.writeFileSync(gapsFile, '# Test GAPS\n');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('main() appends to GAPS.md on unknown query type', async () => {
      const { main } = await import('../ast-query');
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

    it('main() does NOT append to GAPS.md for known unroutable query', async () => {
      const { main } = await import('../ast-query');
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
      // Verify the route structure for dead-exports includes --kind flag
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
