import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeEnvAccess, analyzeEnvAccessDirectory } from '../ast-env-access';
import type { EnvAccessAnalysis, EnvAccessType } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): EnvAccessAnalysis {
  return analyzeEnvAccess(fixturePath(name));
}

function accessesOfType(analysis: EnvAccessAnalysis, type: EnvAccessType) {
  return analysis.accesses.filter(a => a.type === type);
}

describe('ast-env-access', () => {
  describe('CLIENT_ENV_IMPORT', () => {
    it('detects clientEnv import', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const imports = accessesOfType(result, 'CLIENT_ENV_IMPORT');

      expect(imports.length).toBe(1);
      expect(imports[0].text).toContain('clientEnv');
      expect(imports[0].isViolation).toBe(false);
      expect(imports[0].containingFunction).toBe('<module>');
    });
  });

  describe('SERVER_ENV_IMPORT', () => {
    it('detects serverEnv import', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const imports = accessesOfType(result, 'SERVER_ENV_IMPORT');

      expect(imports.length).toBe(1);
      expect(imports[0].text).toContain('serverEnv');
      expect(imports[0].isViolation).toBe(false);
    });
  });

  describe('CLIENT_ENV_ACCESS', () => {
    it('detects clientEnv property accesses as compliant', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const accesses = accessesOfType(result, 'CLIENT_ENV_ACCESS');

      expect(accesses.length).toBe(3);
      expect(accesses[0].propertyName).toBe('NEXT_PUBLIC_API_URL');
      expect(accesses[0].isViolation).toBe(false);
      expect(accesses[0].containingFunction).toBe('<module>');
    });

    it('reports containing function for clientEnv in a function', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const accesses = accessesOfType(result, 'CLIENT_ENV_ACCESS');
      const inFunction = accesses.find(a => a.propertyName === 'NEXT_PUBLIC_BASE_URL');

      expect(inFunction).toBeDefined();
      expect(inFunction!.containingFunction).toBe('getBaseUrl');
    });

    it('reports containing function for clientEnv in an arrow function', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const accesses = accessesOfType(result, 'CLIENT_ENV_ACCESS');
      const inArrow = accesses.find(a => a.propertyName === 'NEXT_PUBLIC_HOST');

      expect(inArrow).toBeDefined();
      expect(inArrow!.containingFunction).toBe('getConfig');
    });
  });

  describe('SERVER_ENV_ACCESS', () => {
    it('detects serverEnv property accesses as compliant', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const accesses = accessesOfType(result, 'SERVER_ENV_ACCESS');

      expect(accesses.length).toBe(2);
      const dbUrl = accesses.find(a => a.propertyName === 'DATABASE_URL');
      expect(dbUrl).toBeDefined();
      expect(dbUrl!.isViolation).toBe(false);
      expect(dbUrl!.containingFunction).toBe('getDatabaseUrl');
    });
  });

  describe('DIRECT_PROCESS_ENV (violation)', () => {
    it('detects direct process.env access as violation', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_PROCESS_ENV');
      const violations = direct.filter(a => a.isViolation);

      expect(violations.length).toBeGreaterThanOrEqual(2);
      const someVar = violations.find(a => a.propertyName === 'SOME_VAR');
      expect(someVar).toBeDefined();
      expect(someVar!.isViolation).toBe(true);
      expect(someVar!.isTreeShakingGuard).toBe(false);
    });

    it('reports containing function for direct access in a function', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_PROCESS_ENV');
      const inFunction = direct.find(a => a.propertyName === 'DATABASE_URL');

      expect(inFunction).toBeDefined();
      expect(inFunction!.containingFunction).toBe('readEnvDirectly');
    });
  });

  describe('DIRECT_PROCESS_ENV (tree-shaking guard)', () => {
    it('marks eslint-disable tree-shaking guard as non-violation', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_PROCESS_ENV');
      const guards = direct.filter(a => a.isTreeShakingGuard);

      expect(guards.length).toBe(2);
      expect(guards[0].isViolation).toBe(false);
      expect(guards[0].propertyName).toBe('NEXT_PUBLIC_ENVIRONMENT');
    });
  });

  describe('RAW_ENV_IMPORT', () => {
    it('detects assignment of process.env to a variable', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const rawImports = accessesOfType(result, 'RAW_ENV_IMPORT');

      expect(rawImports.length).toBe(1);
      expect(rawImports[0].text).toContain('process.env');
      expect(rawImports[0].isViolation).toBe(true);
      expect(rawImports[0].isTreeShakingGuard).toBe(false);
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual access counts', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const { summary, accesses } = result;

      for (const type of Object.keys(summary) as EnvAccessType[]) {
        const count = accesses.filter(a => a.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected access types', () => {
      const result = analyzeFixture('env-access-samples.ts');
      expect(result.summary.DIRECT_PROCESS_ENV).toBeGreaterThan(0);
      expect(result.summary.CLIENT_ENV_ACCESS).toBeGreaterThan(0);
      expect(result.summary.SERVER_ENV_ACCESS).toBeGreaterThan(0);
      expect(result.summary.CLIENT_ENV_IMPORT).toBeGreaterThan(0);
      expect(result.summary.SERVER_ENV_IMPORT).toBeGreaterThan(0);
      expect(result.summary.RAW_ENV_IMPORT).toBeGreaterThan(0);
    });
  });

  describe('violation and compliant counts', () => {
    it('violationCount matches accesses with isViolation: true', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const expected = result.accesses.filter(a => a.isViolation).length;
      expect(result.violationCount).toBe(expected);
    });

    it('compliantCount matches accesses with isViolation: false', () => {
      const result = analyzeFixture('env-access-samples.ts');
      const expected = result.accesses.filter(a => !a.isViolation).length;
      expect(result.compliantCount).toBe(expected);
    });

    it('violationCount + compliantCount equals total accesses', () => {
      const result = analyzeFixture('env-access-samples.ts');
      expect(result.violationCount + result.compliantCount).toBe(result.accesses.length);
    });
  });

  describe('ordering', () => {
    it('accesses are sorted by line number', () => {
      const result = analyzeFixture('env-access-samples.ts');
      for (let i = 1; i < result.accesses.length; i++) {
        const prev = result.accesses[i - 1];
        const curr = result.accesses[i];
        expect(prev.line <= curr.line, `access at line ${prev.line} should come before line ${curr.line}`).toBe(true);
      }
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real project file without crashing', () => {
      const realResult = analyzeEnvAccess('src/shared/lib/env/clientEnv.ts');

      expect(realResult.filePath).toContain('clientEnv');
      expect(realResult.accesses).toBeDefined();
      expect(realResult.summary).toBeDefined();

      const expectedKeys: EnvAccessType[] = [
        'DIRECT_PROCESS_ENV',
        'CLIENT_ENV_ACCESS',
        'SERVER_ENV_ACCESS',
        'CLIENT_ENV_IMPORT',
        'SERVER_ENV_IMPORT',
        'RAW_ENV_IMPORT',
      ];
      for (const key of expectedKeys) {
        expect(realResult.summary).toHaveProperty(key);
        expect(typeof realResult.summary[key]).toBe('number');
      }
    });
  });
});

describe('analyzeEnvAccessDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeEnvAccessDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });
});
