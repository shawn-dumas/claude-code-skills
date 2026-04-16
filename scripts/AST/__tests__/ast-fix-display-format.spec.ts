import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fixSourceFile } from '../ast-fix-display-format';

const GROUND_TRUTH_DIR = path.resolve(__dirname, '../ground-truth/fixtures');
const FIXTURE_PREFIX = 'git-fix-display-';

interface FixtureManifest {
  readonly tool: string;
  readonly fixtureRole?: string;
  readonly expectedFixerBehavior?: string;
  readonly expectedTransforms?: readonly { readonly kind: string; readonly line: number }[];
}

function loadManifest(fixtureDir: string): FixtureManifest {
  const manifestPath = path.join(GROUND_TRUTH_DIR, fixtureDir, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as FixtureManifest;
}

function isNegativeFixture(manifest: FixtureManifest): boolean {
  return manifest.fixtureRole?.includes('negative') ?? false;
}

function listFixtures(): string[] {
  return fs
    .readdirSync(GROUND_TRUTH_DIR)
    .filter(name => name.startsWith(FIXTURE_PREFIX))
    .sort();
}

describe('ast-fix-display-format', () => {
  describe('fixture corpus', () => {
    const fixtures = listFixtures();

    it('has at least one apply fixture and one skip fixture', () => {
      expect(fixtures.length).toBeGreaterThan(0);
      const manifests = fixtures.map(loadManifest);
      expect(manifests.some(isNegativeFixture)).toBe(true);
      expect(manifests.some(m => !isNegativeFixture(m))).toBe(true);
    });

    for (const fixture of fixtures) {
      it(`${fixture}: fixer output matches expected`, () => {
        const manifest = loadManifest(fixture);
        const beforePath = path.join(GROUND_TRUTH_DIR, fixture, 'before.tsx');
        const expectedPath = path.join(
          GROUND_TRUTH_DIR,
          fixture,
          isNegativeFixture(manifest) ? 'before.tsx' : 'after.tsx',
        );

        const result = fixSourceFile(beforePath);
        const expected = fs.readFileSync(expectedPath, 'utf-8');
        expect(result.text).toBe(expected);
      });
    }

    for (const fixture of fixtures) {
      const manifest = loadManifest(fixture);

      if (isNegativeFixture(manifest)) {
        it(`${fixture}: fixer applies zero transforms (gated by review)`, () => {
          const beforePath = path.join(GROUND_TRUTH_DIR, fixture, 'before.tsx');
          const result = fixSourceFile(beforePath);
          expect(result.applied).toHaveLength(0);
        });
        continue;
      }

      if (manifest.expectedTransforms) {
        it(`${fixture}: fixer applies all expected transforms`, () => {
          const beforePath = path.join(GROUND_TRUTH_DIR, fixture, 'before.tsx');
          const result = fixSourceFile(beforePath);
          expect(result.applied.length).toBe(manifest.expectedTransforms!.length);
          for (const expected of manifest.expectedTransforms!) {
            const matched = result.applied.find(a => a.kind === expected.kind && a.line === expected.line);
            expect(matched).toBeDefined();
          }
        });
      }
    }
  });
});
