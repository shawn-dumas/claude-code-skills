import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeStorageAccess } from '../ast-storage-access';
import type { StorageAccessAnalysis, StorageAccessType } from '../types';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function analyzeFixture(name: string): StorageAccessAnalysis {
  return analyzeStorageAccess(fixturePath(name));
}

function accessesOfType(analysis: StorageAccessAnalysis, type: StorageAccessType) {
  return analysis.accesses.filter(a => a.type === type);
}

describe('ast-storage-access', () => {
  const result = analyzeFixture('storage-access-samples.ts');

  describe('DIRECT_LOCAL_STORAGE', () => {
    it('detects localStorage.getItem', () => {
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');

      expect(direct.length).toBeGreaterThanOrEqual(1);
      const getItem = direct.find(a => a.text.includes('localStorage.getItem'));
      expect(getItem).toBeDefined();
      expect(getItem!.isViolation).toBe(true);
      expect(getItem!.containingFunction).toBe('directLocalStorageGetItem');
    });

    it('detects localStorage.setItem', () => {
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const setItem = direct.find(a => a.text.includes('localStorage.setItem'));

      expect(setItem).toBeDefined();
      expect(setItem!.isViolation).toBe(true);
    });

    it('detects localStorage.removeItem', () => {
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const removeItem = direct.find(a => a.text.includes('localStorage.removeItem'));

      expect(removeItem).toBeDefined();
    });

    it('detects localStorage.clear', () => {
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const clear = direct.find(a => a.text.includes('localStorage.clear'));

      expect(clear).toBeDefined();
    });
  });

  describe('DIRECT_SESSION_STORAGE', () => {
    it('detects sessionStorage.getItem', () => {
      const direct = accessesOfType(result, 'DIRECT_SESSION_STORAGE');

      expect(direct.length).toBeGreaterThanOrEqual(1);
      const getItem = direct.find(a => a.text.includes('sessionStorage.getItem'));
      expect(getItem).toBeDefined();
      expect(getItem!.isViolation).toBe(true);
    });

    it('detects sessionStorage.setItem', () => {
      const direct = accessesOfType(result, 'DIRECT_SESSION_STORAGE');
      const setItem = direct.find(a => a.text.includes('sessionStorage.setItem'));

      expect(setItem).toBeDefined();
      expect(setItem!.isViolation).toBe(true);
    });
  });

  describe('TYPED_STORAGE_READ', () => {
    it('detects readStorage as compliant', () => {
      const reads = accessesOfType(result, 'TYPED_STORAGE_READ');

      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect(reads[0].isViolation).toBe(false);
      expect(reads[0].text).toContain('readStorage');
    });
  });

  describe('TYPED_STORAGE_WRITE', () => {
    it('detects writeStorage as compliant', () => {
      const writes = accessesOfType(result, 'TYPED_STORAGE_WRITE');

      expect(writes.length).toBeGreaterThanOrEqual(1);
      expect(writes[0].isViolation).toBe(false);
      expect(writes[0].text).toContain('writeStorage');
    });
  });

  describe('TYPED_STORAGE_REMOVE', () => {
    it('detects removeStorage as compliant', () => {
      const removes = accessesOfType(result, 'TYPED_STORAGE_REMOVE');

      expect(removes.length).toBeGreaterThanOrEqual(1);
      expect(removes[0].isViolation).toBe(false);
      expect(removes[0].text).toContain('removeStorage');
    });
  });

  describe('JSON_PARSE_UNVALIDATED', () => {
    it('detects JSON.parse without Zod validation', () => {
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');

      expect(unvalidated.length).toBeGreaterThanOrEqual(1);
      expect(unvalidated[0].isViolation).toBe(true);
      expect(unvalidated[0].text).toContain('JSON.parse');
    });

    it('does NOT flag JSON.parse wrapped in schema.parse()', () => {
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');
      const zodGuarded = unvalidated.filter(a => a.containingFunction === 'jsonParseWithZodParse');

      expect(zodGuarded).toHaveLength(0);
    });

    it('does NOT flag JSON.parse wrapped in schema.safeParse()', () => {
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');
      const zodGuarded = unvalidated.filter(a => a.containingFunction === 'jsonParseWithZodSafeParse');

      expect(zodGuarded).toHaveLength(0);
    });
  });

  describe('COOKIE_ACCESS', () => {
    it('detects document.cookie read', () => {
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const docCookie = cookies.find(a => a.text.includes('document.cookie'));

      expect(docCookie).toBeDefined();
      expect(docCookie!.isViolation).toBe(false);
    });

    it('detects Cookies.get (js-cookie)', () => {
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsGet = cookies.find(a => a.text.includes('Cookies.get'));

      expect(jsGet).toBeDefined();
      expect(jsGet!.isViolation).toBe(false);
    });

    it('detects Cookies.set (js-cookie)', () => {
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsSet = cookies.find(a => a.text.includes('Cookies.set'));

      expect(jsSet).toBeDefined();
    });

    it('detects Cookies.remove (js-cookie)', () => {
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsRemove = cookies.find(a => a.text.includes('Cookies.remove'));

      expect(jsRemove).toBeDefined();
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual access counts', () => {
      const { summary, accesses } = result;

      for (const type of Object.keys(summary) as StorageAccessType[]) {
        const count = accesses.filter(a => a.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected access types', () => {
      expect(result.summary.DIRECT_LOCAL_STORAGE).toBeGreaterThan(0);
      expect(result.summary.DIRECT_SESSION_STORAGE).toBeGreaterThan(0);
      expect(result.summary.TYPED_STORAGE_READ).toBeGreaterThan(0);
      expect(result.summary.TYPED_STORAGE_WRITE).toBeGreaterThan(0);
      expect(result.summary.TYPED_STORAGE_REMOVE).toBeGreaterThan(0);
      expect(result.summary.JSON_PARSE_UNVALIDATED).toBeGreaterThan(0);
      expect(result.summary.COOKIE_ACCESS).toBeGreaterThan(0);
    });
  });

  describe('violation and compliant counts', () => {
    it('violationCount matches violations in accesses', () => {
      const violations = result.accesses.filter(a => a.isViolation);
      expect(result.violationCount).toBe(violations.length);
    });

    it('compliantCount matches compliant accesses', () => {
      const compliant = result.accesses.filter(a => !a.isViolation);
      expect(result.compliantCount).toBe(compliant.length);
    });

    it('violationCount + compliantCount equals total accesses', () => {
      expect(result.violationCount + result.compliantCount).toBe(result.accesses.length);
    });
  });

  describe('containingFunction', () => {
    it('reports the correct containing function name', () => {
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const setItemAccess = direct.find(a => a.text.includes('localStorage.setItem'));

      expect(setItemAccess).toBeDefined();
      expect(setItemAccess!.containingFunction).toBe('directLocalStorageSetItem');
    });
  });

  describe('real file smoke test', () => {
    it('analyzes a real project file without crashing', () => {
      const realResult = analyzeStorageAccess('src/shared/utils/typedStorage.ts');

      expect(realResult.filePath).toContain('typedStorage');
      expect(realResult.accesses).toBeDefined();
      expect(realResult.summary).toBeDefined();

      // Verify all summary keys exist
      const expectedKeys: StorageAccessType[] = [
        'DIRECT_LOCAL_STORAGE',
        'DIRECT_SESSION_STORAGE',
        'TYPED_STORAGE_READ',
        'TYPED_STORAGE_WRITE',
        'TYPED_STORAGE_REMOVE',
        'JSON_PARSE_UNVALIDATED',
        'COOKIE_ACCESS',
      ];
      for (const key of expectedKeys) {
        expect(realResult.summary).toHaveProperty(key);
        expect(typeof realResult.summary[key]).toBe('number');
      }
    });
  });
});
