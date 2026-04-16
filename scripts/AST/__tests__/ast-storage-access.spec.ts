import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeStorageAccess, analyzeStorageAccessDirectory, extractStorageObservations } from '../ast-storage-access';
import { getSourceFile } from '../project';
import type { StorageAccessAnalysis, StorageAccessType, StorageObservation, StorageObservationKind } from '../types';

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

function observationsOfKind(observations: StorageObservation[], kind: StorageObservationKind) {
  return observations.filter(o => o.kind === kind);
}

describe('ast-storage-access', () => {
  describe('DIRECT_LOCAL_STORAGE', () => {
    it('detects localStorage.getItem', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');

      expect(direct.length).toBeGreaterThanOrEqual(1);
      const getItem = direct.find(a => a.text.includes('localStorage.getItem'));
      expect(getItem).toBeDefined();
      expect(getItem!.isViolation).toBe(true);
      expect(getItem!.containingFunction).toBe('directLocalStorageGetItem');
    });

    it('detects localStorage.setItem', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const setItem = direct.find(a => a.text.includes('localStorage.setItem'));

      expect(setItem).toBeDefined();
      expect(setItem!.isViolation).toBe(true);
    });

    it('detects localStorage.removeItem', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const removeItem = direct.find(a => a.text.includes('localStorage.removeItem'));

      expect(removeItem).toBeDefined();
    });

    it('detects localStorage.clear', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
      const clear = direct.find(a => a.text.includes('localStorage.clear'));

      expect(clear).toBeDefined();
    });
  });

  describe('DIRECT_SESSION_STORAGE', () => {
    it('detects sessionStorage.getItem', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_SESSION_STORAGE');

      expect(direct.length).toBeGreaterThanOrEqual(1);
      const getItem = direct.find(a => a.text.includes('sessionStorage.getItem'));
      expect(getItem).toBeDefined();
      expect(getItem!.isViolation).toBe(true);
    });

    it('detects sessionStorage.setItem', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const direct = accessesOfType(result, 'DIRECT_SESSION_STORAGE');
      const setItem = direct.find(a => a.text.includes('sessionStorage.setItem'));

      expect(setItem).toBeDefined();
      expect(setItem!.isViolation).toBe(true);
    });
  });

  describe('TYPED_STORAGE_READ', () => {
    it('detects readStorage as compliant', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const reads = accessesOfType(result, 'TYPED_STORAGE_READ');

      expect(reads.length).toBeGreaterThanOrEqual(1);
      expect(reads[0].isViolation).toBe(false);
      expect(reads[0].text).toContain('readStorage');
    });
  });

  describe('TYPED_STORAGE_WRITE', () => {
    it('detects writeStorage as compliant', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const writes = accessesOfType(result, 'TYPED_STORAGE_WRITE');

      expect(writes.length).toBeGreaterThanOrEqual(1);
      expect(writes[0].isViolation).toBe(false);
      expect(writes[0].text).toContain('writeStorage');
    });
  });

  describe('TYPED_STORAGE_REMOVE', () => {
    it('detects removeStorage as compliant', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const removes = accessesOfType(result, 'TYPED_STORAGE_REMOVE');

      expect(removes.length).toBeGreaterThanOrEqual(1);
      expect(removes[0].isViolation).toBe(false);
      expect(removes[0].text).toContain('removeStorage');
    });
  });

  describe('JSON_PARSE_UNVALIDATED', () => {
    it('detects JSON.parse without Zod validation', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');

      expect(unvalidated.length).toBeGreaterThanOrEqual(1);
      expect(unvalidated[0].isViolation).toBe(true);
      expect(unvalidated[0].text).toContain('JSON.parse');
    });

    it('does NOT flag JSON.parse wrapped in schema.parse()', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');
      const zodGuarded = unvalidated.filter(a => a.containingFunction === 'jsonParseWithZodParse');

      expect(zodGuarded).toHaveLength(0);
    });

    it('does NOT flag JSON.parse wrapped in schema.safeParse()', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const unvalidated = accessesOfType(result, 'JSON_PARSE_UNVALIDATED');
      const zodGuarded = unvalidated.filter(a => a.containingFunction === 'jsonParseWithZodSafeParse');

      expect(zodGuarded).toHaveLength(0);
    });
  });

  describe('COOKIE_ACCESS', () => {
    it('detects document.cookie read', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const docCookie = cookies.find(a => a.text.includes('document.cookie'));

      expect(docCookie).toBeDefined();
      expect(docCookie!.isViolation).toBe(false);
    });

    it('detects Cookies.get (js-cookie)', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsGet = cookies.find(a => a.text.includes('Cookies.get'));

      expect(jsGet).toBeDefined();
      expect(jsGet!.isViolation).toBe(false);
    });

    it('detects Cookies.set (js-cookie)', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsSet = cookies.find(a => a.text.includes('Cookies.set'));

      expect(jsSet).toBeDefined();
    });

    it('detects Cookies.remove (js-cookie)', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const cookies = accessesOfType(result, 'COOKIE_ACCESS');
      const jsRemove = cookies.find(a => a.text.includes('Cookies.remove'));

      expect(jsRemove).toBeDefined();
    });
  });

  describe('summary counts', () => {
    it('summary counts match individual access counts', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const { summary, accesses } = result;

      for (const type of Object.keys(summary) as StorageAccessType[]) {
        const count = accesses.filter(a => a.type === type).length;
        expect(summary[type], `Summary for ${type} should be ${count}`).toBe(count);
      }
    });

    it('has non-zero counts for expected access types', () => {
      const result = analyzeFixture('storage-access-samples.ts');
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
      const result = analyzeFixture('storage-access-samples.ts');
      const violations = result.accesses.filter(a => a.isViolation);
      expect(result.violationCount).toBe(violations.length);
    });

    it('compliantCount matches compliant accesses', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      const compliant = result.accesses.filter(a => !a.isViolation);
      expect(result.compliantCount).toBe(compliant.length);
    });

    it('violationCount + compliantCount equals total accesses', () => {
      const result = analyzeFixture('storage-access-samples.ts');
      expect(result.violationCount + result.compliantCount).toBe(result.accesses.length);
    });
  });

  describe('containingFunction', () => {
    it('reports the correct containing function name', () => {
      const result = analyzeFixture('storage-access-samples.ts');
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

describe('analyzeStorageAccessDirectory', () => {
  it('analyzes all matching files in a directory', () => {
    const results = analyzeStorageAccessDirectory(FIXTURES_DIR);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.filePath).toBeDefined();
    }
  });
});

describe('observations', () => {
  it('emits observations alongside legacy accesses', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    expect(result.observations).toBeDefined();
    expect(result.observations.length).toBeGreaterThan(0);
  });

  it('emits DIRECT_STORAGE_CALL for localStorage methods', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    const direct = observationsOfKind(result.observations, 'DIRECT_STORAGE_CALL');
    expect(direct.length).toBeGreaterThanOrEqual(1);
    const getItem = direct.find(o => o.evidence.method === 'getItem');
    expect(getItem).toBeDefined();
    expect(getItem!.evidence.storageType).toBe('localStorage');
  });

  it('emits TYPED_STORAGE_CALL for readStorage/writeStorage/removeStorage', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    const typed = observationsOfKind(result.observations, 'TYPED_STORAGE_CALL');
    expect(typed.length).toBeGreaterThanOrEqual(3);
    expect(typed.some(o => o.evidence.helperName === 'readStorage')).toBe(true);
    expect(typed.some(o => o.evidence.helperName === 'writeStorage')).toBe(true);
    expect(typed.some(o => o.evidence.helperName === 'removeStorage')).toBe(true);
  });

  it('emits JSON_PARSE_CALL for unguarded JSON.parse', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    const jsonParse = observationsOfKind(result.observations, 'JSON_PARSE_CALL');
    expect(jsonParse.length).toBeGreaterThanOrEqual(1);
    expect(jsonParse[0].evidence.isZodGuarded).toBe(false);
  });

  it('emits JSON_PARSE_ZOD_GUARDED for Zod-wrapped JSON.parse', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    const guarded = observationsOfKind(result.observations, 'JSON_PARSE_ZOD_GUARDED');
    expect(guarded.length).toBeGreaterThanOrEqual(2);
    expect(guarded[0].evidence.isZodGuarded).toBe(true);
  });

  it('emits COOKIE_CALL for Cookies.get/set/remove and document.cookie', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    const cookies = observationsOfKind(result.observations, 'COOKIE_CALL');
    expect(cookies.length).toBeGreaterThanOrEqual(4);
  });

  it('includes file path in observations', () => {
    const result = analyzeFixture('storage-access-samples.ts');
    for (const obs of result.observations) {
      expect(obs.file).toContain('storage-access-samples.ts');
    }
  });
});

describe('extractStorageObservations', () => {
  it('extracts observations directly from source file', () => {
    const sf = getSourceFile(fixturePath('storage-access-samples.ts'));
    const observations = extractStorageObservations(sf);
    expect(observations.length).toBeGreaterThan(0);
  });
});

describe('negative fixtures', () => {
  it('still detects shadowed localStorage (no scope tracking)', () => {
    const result = analyzeFixture('storage-negative.ts');
    const direct = accessesOfType(result, 'DIRECT_LOCAL_STORAGE');
    // Shadowed localStorage.getItem is still detected
    expect(direct.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT flag method call on object with readStorage method', () => {
    const result = analyzeFixture('storage-negative.ts');
    const observations = result.observations;
    // store.readStorage() should NOT be TYPED_STORAGE_CALL
    const typed = observationsOfKind(observations, 'TYPED_STORAGE_CALL');
    // There should be 0 typed storage calls in negative fixture
    expect(typed.length).toBe(0);
  });

  it('detects JSON.parse even in non-storage context', () => {
    const result = analyzeFixture('storage-negative.ts');
    const jsonParse = observationsOfKind(result.observations, 'JSON_PARSE_CALL');
    expect(jsonParse.length).toBeGreaterThanOrEqual(1);
  });

  it('detects sessionStorage.length as STORAGE_PROPERTY_ACCESS', () => {
    const result = analyzeFixture('storage-negative.ts');
    const propAccess = observationsOfKind(result.observations, 'STORAGE_PROPERTY_ACCESS');
    expect(propAccess.length).toBeGreaterThanOrEqual(1);
    const lengthAccess = propAccess.find(o => o.evidence.method === 'length');
    expect(lengthAccess).toBeDefined();
  });

  it('does NOT flag MyCookies.get as COOKIE_CALL', () => {
    const result = analyzeFixture('storage-negative.ts');
    const cookies = observationsOfKind(result.observations, 'COOKIE_CALL');
    // Only Cookies.* calls should be flagged, not MyCookies.*
    expect(cookies.length).toBe(0);
  });
});
