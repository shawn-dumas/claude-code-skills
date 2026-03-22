import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { analyzeBrandedCheck, analyzeBrandedCheckDirectory } from '../ast-branded-check';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

function fixtureDir(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function fixturePath(dir: string, file: string): string {
  return path.join(FIXTURES_DIR, dir, file);
}

function loadManifest(dir: string): {
  expectedObservations: {
    kind: string;
    parameterName?: string;
    functionName?: string;
    expectedType?: string;
  }[];
} {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(dir), 'manifest.json'), 'utf-8')) as ReturnType<
    typeof loadManifest
  >;
}

// ---------------------------------------------------------------------------
// Synthetic fixture tests: UNBRANDED_PARAM
// ---------------------------------------------------------------------------

describe('ast-branded-check: UNBRANDED_PARAM synthetic fixtures', () => {
  describe('branded-type-gaps-clean', () => {
    it('emits no observations for functions using branded types correctly', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-clean', 'service.ts'));
      const manifest = loadManifest('branded-type-gaps-clean');

      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');
      expect(paramObs).toHaveLength(0);
      expect(manifest.expectedObservations).toHaveLength(0);
    });
  });

  describe('branded-type-gaps-bare-param', () => {
    it('emits UNBRANDED_PARAM for functions with bare primitive parameters', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-param', 'service.ts'));
      const manifest = loadManifest('branded-type-gaps-bare-param');

      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      // Should match the expected count from manifest
      expect(paramObs).toHaveLength(manifest.expectedObservations.length);

      // Verify each expected observation is present
      for (const expected of manifest.expectedObservations) {
        const found = paramObs.find(
          o =>
            o.evidence.parameterName === expected.parameterName &&
            o.evidence.functionName === expected.functionName &&
            o.evidence.expectedType === expected.expectedType,
        );
        expect(found, `expected observation for ${expected.functionName}.${expected.parameterName}`).toBeDefined();
      }
    });

    it('does not flag allowlisted parameter names', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-param', 'service.ts'));
      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      // 'name' and 'description' are in paramExcludeNames -- they should not appear
      const nameObs = paramObs.filter(
        o => o.evidence.parameterName === 'name' || o.evidence.parameterName === 'description',
      );
      expect(nameObs).toHaveLength(0);
    });

    it('includes evidence explaining why the branded type applies', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-param', 'service.ts'));
      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      for (const obs of paramObs) {
        expect(obs.evidence.evidence).toBeDefined();
        expect(obs.evidence.evidence!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('branded-type-gaps-bare-return', () => {
    it('emits UNBRANDED_PARAM for functions returning bare primitives in branded context', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-return', 'service.ts'));
      const manifest = loadManifest('branded-type-gaps-bare-return');

      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      expect(paramObs).toHaveLength(manifest.expectedObservations.length);

      for (const expected of manifest.expectedObservations) {
        const found = paramObs.find(
          o =>
            o.evidence.parameterName === expected.parameterName &&
            o.evidence.functionName === expected.functionName &&
            o.evidence.expectedType === expected.expectedType,
        );
        expect(found, `expected observation for ${expected.functionName} return type`).toBeDefined();
      }
    });

    it('does not flag getUserName returning string (no branded context)', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-return', 'service.ts'));
      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      const nameObs = paramObs.filter(o => o.evidence.functionName === 'getUserName');
      expect(nameObs).toHaveLength(0);
    });

    it('does not flag fetchUser returning complex type', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-return', 'service.ts'));
      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      const fetchObs = paramObs.filter(o => o.evidence.functionName === 'fetchUser');
      expect(fetchObs).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Real-world fixture tests
// ---------------------------------------------------------------------------

describe('ast-branded-check: UNBRANDED_PARAM real-world fixtures', () => {
  describe('branded-type-gaps-real-clean', () => {
    it('emits no UNBRANDED_PARAM for properly branded query param functions', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-real-clean', 'queryParams.ts'));
      const manifest = loadManifest('branded-type-gaps-real-clean');

      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');
      expect(paramObs).toHaveLength(0);
      expect(manifest.expectedObservations).toHaveLength(0);
    });
  });

  describe('branded-type-gaps-real-gaps', () => {
    it('emits UNBRANDED_PARAM for data logic functions with bare primitives', () => {
      const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-real-gaps', 'dataLogic.ts'));
      const manifest = loadManifest('branded-type-gaps-real-gaps');

      const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

      expect(paramObs).toHaveLength(manifest.expectedObservations.length);

      for (const expected of manifest.expectedObservations) {
        const found = paramObs.find(
          o =>
            o.evidence.parameterName === expected.parameterName &&
            o.evidence.functionName === expected.functionName &&
            o.evidence.expectedType === expected.expectedType,
        );
        expect(
          found,
          `expected observation for ${expected.functionName}.${expected.parameterName} -> ${expected.expectedType}`,
        ).toBeDefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Directory analysis tests
// ---------------------------------------------------------------------------

describe('ast-branded-check: directory analysis', () => {
  it('finds UNBRANDED_PARAM observations in a directory with gaps', () => {
    const results = analyzeBrandedCheckDirectory(fixtureDir('branded-type-gaps-bare-param'));
    expect(results.length).toBeGreaterThanOrEqual(1);

    const allObs = results.flatMap(r => r.observations);
    const paramObs = allObs.filter(o => o.kind === 'UNBRANDED_PARAM');
    expect(paramObs.length).toBeGreaterThanOrEqual(1);
  });

  it('finds no UNBRANDED_PARAM observations in a clean directory', () => {
    const results = analyzeBrandedCheckDirectory(fixtureDir('branded-type-gaps-clean'));

    const allObs = results.flatMap(r => r.observations);
    const paramObs = allObs.filter(o => o.kind === 'UNBRANDED_PARAM');
    expect(paramObs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Evidence field tests
// ---------------------------------------------------------------------------

describe('ast-branded-check: evidence fields', () => {
  it('includes declaredType in UNBRANDED_PARAM evidence', () => {
    const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-param', 'service.ts'));
    const paramObs = result.observations.filter(o => o.kind === 'UNBRANDED_PARAM');

    for (const obs of paramObs) {
      expect(obs.evidence.declaredType).toBeDefined();
      expect(['string', 'number']).toContain(obs.evidence.declaredType);
    }
  });

  it('return type observations have parameterName "return"', () => {
    const result = analyzeBrandedCheck(fixturePath('branded-type-gaps-bare-return', 'service.ts'));
    const returnObs = result.observations.filter(
      o => o.kind === 'UNBRANDED_PARAM' && o.evidence.parameterName === 'return',
    );
    expect(returnObs.length).toBeGreaterThan(0);
  });
});
