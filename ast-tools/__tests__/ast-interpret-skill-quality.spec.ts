import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeSkillFile, analyzeSkillDirectory } from '../ast-skill-analysis';
import { interpretSkillQuality } from '../ast-interpret-skill-quality';
import type { SkillQualityAssessment, SkillQualityAssessmentKind } from '../types';

// -- Helpers --

const FIXTURES_DIR = path.join(__dirname, 'fixtures/skill-analysis');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

const MOCK_SKILL_DIRS = new Set([
  'audit-react-feature',
  'build-module-test',
  'build-ast-tool',
  'refactor-react-component',
  'spawn-satan',
  'flatten-jsx-template',
  'test-positive-skill',
  'test-negative-skill',
  'test-minimal-skill',
]);

function findByKind(
  assessments: readonly SkillQualityAssessment[],
  kind: SkillQualityAssessmentKind,
): SkillQualityAssessment[] {
  return assessments.filter(a => a.kind === kind);
}

// -- Synthetic fixture assessments --

describe('ast-interpret-skill-quality (synthetic fixtures)', () => {
  describe('positive fixture (all valid)', () => {
    const obs = analyzeSkillFile(fixturePath('skill-positive.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('produces no stale file path assessments', () => {
      const stale = findByKind(report.assessments, 'STALE_FILE_PATH');
      expect(stale).toHaveLength(0);
    });

    it('produces PATH_VALID assessments for existing paths', () => {
      const valid = findByKind(report.assessments, 'PATH_VALID');
      expect(valid.length).toBeGreaterThan(0);
      // scripts/AST/types.ts should be valid
      const typesValid = valid.find(a => a.subject.symbol === 'scripts/AST/types.ts');
      expect(typesValid).toBeDefined();
    });

    it('produces no broken cross-refs', () => {
      expect(findByKind(report.assessments, 'BROKEN_CROSS_REF')).toHaveLength(0);
    });

    it('produces CROSS_REF_VALID for existing skill refs', () => {
      const valid = findByKind(report.assessments, 'CROSS_REF_VALID');
      expect(valid.length).toBeGreaterThan(0);
    });

    it('produces no broken doc refs', () => {
      expect(findByKind(report.assessments, 'BROKEN_DOC_REF')).toHaveLength(0);
    });

    it('produces no stale commands', () => {
      expect(findByKind(report.assessments, 'STALE_COMMAND')).toHaveLength(0);
    });

    it('has score of 100', () => {
      expect(report.score).toBe(100);
    });
  });

  describe('negative fixture (stale paths, broken refs, aspirational)', () => {
    const obs = analyzeSkillFile(fixturePath('skill-negative.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('detects stale file paths', () => {
      const stale = findByKind(report.assessments, 'STALE_FILE_PATH');
      expect(stale.length).toBeGreaterThanOrEqual(3);
      const nonexistent = stale.find(a => a.subject.symbol?.includes('src/nonexistent'));
      expect(nonexistent).toBeDefined();
      expect(nonexistent?.confidence).toBe('high');
    });

    it('classifies paths with creation-intent verbs as ASPIRATIONAL_PATH', () => {
      const aspirational = findByKind(report.assessments, 'ASPIRATIONAL_PATH');
      expect(aspirational.length).toBeGreaterThanOrEqual(1);
      const fetchers = aspirational.find(a => a.subject.symbol?.includes('src/server/aspirational'));
      expect(fetchers).toBeDefined();
      expect(fetchers?.rationale[0]).toContain('creation intent');
    });

    it('detects broken cross-references', () => {
      const broken = findByKind(report.assessments, 'BROKEN_CROSS_REF');
      expect(broken.length).toBeGreaterThanOrEqual(1);
      const brokenRef = broken.find(a => a.subject.symbol === 'nonexistent-skill-name');
      expect(brokenRef).toBeDefined();
    });

    it('detects broken doc references', () => {
      const broken = findByKind(report.assessments, 'BROKEN_DOC_REF');
      expect(broken.length).toBeGreaterThanOrEqual(1);
      const brokenDoc = broken.find(a => a.subject.symbol === 'docs/this-doc-does-not-exist.md');
      expect(brokenDoc).toBeDefined();
    });

    it('detects deprecated tsc command (missing -p flag)', () => {
      const stale = findByKind(report.assessments, 'STALE_COMMAND');
      expect(stale.length).toBeGreaterThanOrEqual(1);
      const tscCmd = stale.find(a => a.subject.symbol?.includes('pnpm tsc --noEmit'));
      expect(tscCmd).toBeDefined();
      expect(tscCmd?.rationale[0]).toContain('tsconfig.check.json');
    });

    it('has staleCount > 0', () => {
      expect(report.staleCount).toBeGreaterThan(0);
    });

    it('has score below 100', () => {
      expect(report.score).toBeLessThan(100);
    });
  });

  describe('minimal fixture', () => {
    const obs = analyzeSkillFile(fixturePath('skill-minimal.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('produces no stale assessments for minimal content', () => {
      expect(report.staleCount).toBe(0);
    });

    it('category is "other" so no missing section checks apply', () => {
      expect(findByKind(report.assessments, 'MISSING_SECTION')).toHaveLength(0);
    });

    it('has score of 100', () => {
      expect(report.score).toBe(100);
    });
  });
});

// -- Real-world fixture assessments --

describe('ast-interpret-skill-quality (real-world fixtures)', () => {
  describe('spawn-satan (clean, other category)', () => {
    const obs = analyzeSkillFile(fixturePath('real-spawn-satan.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('has no issues (score 100)', () => {
      expect(report.score).toBe(100);
      expect(report.staleCount).toBe(0);
      expect(report.missingCount).toBe(0);
    });
  });

  describe('flatten-jsx-template (fixture is in skill-analysis dir, so category=other)', () => {
    const obs = analyzeSkillFile(fixturePath('real-flatten-jsx-template.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('does not apply category-specific section checks for "other" category', () => {
      expect(findByKind(report.assessments, 'MISSING_SECTION')).toHaveLength(0);
    });

    it('has a score', () => {
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });
  });

  describe('pre-fix build-playwright-test (real-world STALE_FILE_PATH + BROKEN_CROSS_REF)', () => {
    const obs = analyzeSkillFile(fixturePath('real-build-playwright-test-prefix.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('detects multiple STALE_FILE_PATH from real stale refs', () => {
      const stale = findByKind(report.assessments, 'STALE_FILE_PATH');
      expect(stale.length).toBeGreaterThanOrEqual(7);
      // Specific real stale paths
      const authUtils = stale.find(a => a.subject.symbol?.includes('authUtils'));
      expect(authUtils).toBeDefined();
      const mockData = stale.find(a => a.subject.symbol?.includes('mockData'));
      expect(mockData).toBeDefined();
    });

    it('detects BROKEN_CROSS_REF from pre-fix skill', () => {
      const broken = findByKind(report.assessments, 'BROKEN_CROSS_REF');
      // create-feedback-fixture is not in MOCK_SKILL_DIRS
      expect(broken.length).toBeGreaterThanOrEqual(1);
    });

    it('has score well below 100', () => {
      expect(report.score).toBeLessThanOrEqual(60);
    });
  });

  describe('migrate-page-to-ssr (real-world ASPIRATIONAL_PATH)', () => {
    const obs = analyzeSkillFile(fixturePath('real-migrate-page-to-ssr.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('classifies src/server/fetchers/ paths as ASPIRATIONAL_PATH', () => {
      const aspirational = findByKind(report.assessments, 'ASPIRATIONAL_PATH');
      expect(aspirational.length).toBe(5);
      // All should reference src/server/fetchers/
      for (const a of aspirational) {
        expect(a.subject.symbol).toContain('src/server/fetchers');
      }
    });

    it('does not flag aspirational paths as STALE_FILE_PATH', () => {
      const stale = findByKind(report.assessments, 'STALE_FILE_PATH');
      const fetchersStale = stale.filter(a => a.subject.symbol?.includes('src/server/fetchers'));
      expect(fetchersStale).toHaveLength(0);
    });

    it('aspirational paths have high confidence and rationale mentioning creation intent', () => {
      const aspirational = findByKind(report.assessments, 'ASPIRATIONAL_PATH');
      for (const a of aspirational) {
        expect(a.confidence).toBe('high');
        expect(a.rationale[0]).toContain('creation intent');
      }
    });
  });

  describe('build-fixture-real (real-world SECTION_COMPLETE for build category)', () => {
    const obs = analyzeSkillFile(path.join(FIXTURES_DIR, 'build-fixture-real', 'SKILL.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('has category build', () => {
      expect(report.category).toBe('build');
    });

    it('produces SECTION_COMPLETE assessment', () => {
      const complete = findByKind(report.assessments, 'SECTION_COMPLETE');
      expect(complete).toHaveLength(1);
      expect(complete[0].confidence).toBe('high');
      expect(complete[0].rationale[0]).toContain('build');
    });

    it('has score 100', () => {
      expect(report.score).toBe(100);
    });
  });

  describe('build-missing-verify (derived real-world MISSING_SECTION)', () => {
    const obs = analyzeSkillFile(path.join(FIXTURES_DIR, 'build-missing-verify', 'SKILL.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);

    it('has category build', () => {
      expect(report.category).toBe('build');
    });

    it('detects MISSING_SECTION for Verify section', () => {
      const missing = findByKind(report.assessments, 'MISSING_SECTION');
      expect(missing).toHaveLength(1);
      expect(missing[0].subject.symbol).toBe('Verify section');
      expect(missing[0].confidence).toBe('medium');
      expect(missing[0].requiresManualReview).toBe(true);
    });

    it('has score below 100 due to missing section', () => {
      expect(report.score).toBe(97);
      expect(report.missingCount).toBe(1);
    });
  });
});

// -- Category-aware section checks --

describe('category-aware section detection', () => {
  it('does not flag missing sections for "other" category', () => {
    const obs = analyzeSkillFile(fixturePath('real-spawn-satan.md'), MOCK_SKILL_DIRS);
    const report = interpretSkillQuality(obs);
    expect(findByKind(report.assessments, 'MISSING_SECTION')).toHaveLength(0);
  });
});

// -- Directory-wide assessment --

describe('directory-wide interpretation', () => {
  it('produces reports for all skills with scores between 0 and 100', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    const reports = results.map(r => interpretSkillQuality(r));
    expect(reports.length).toBeGreaterThanOrEqual(50);
    for (const report of reports) {
      expect(report.score, `${report.skillName} score out of range`).toBeGreaterThanOrEqual(0);
      expect(report.score, `${report.skillName} score out of range`).toBeLessThanOrEqual(100);
    }
  });

  it('every assessment has confidence and rationale', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    const reports = results.map(r => interpretSkillQuality(r));
    for (const report of reports) {
      for (const a of report.assessments) {
        expect(a.confidence, `${report.skillName}: ${a.kind} missing confidence`).toMatch(/^(high|medium|low)$/);
        expect(a.rationale.length, `${report.skillName}: ${a.kind} missing rationale`).toBeGreaterThan(0);
      }
    }
  });

  it('staleCount + missingCount matches issue assessments', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    const reports = results.map(r => interpretSkillQuality(r));
    for (const report of reports) {
      const issueKinds = new Set<SkillQualityAssessmentKind>([
        'STALE_FILE_PATH',
        'STALE_COMMAND',
        'BROKEN_CROSS_REF',
        'BROKEN_DOC_REF',
      ]);
      const actualStale = report.assessments.filter(a => issueKinds.has(a.kind)).length;
      const actualMissing = report.assessments.filter(a => a.kind === 'MISSING_SECTION').length;
      expect(report.staleCount, `${report.skillName}: staleCount mismatch`).toBe(actualStale);
      expect(report.missingCount, `${report.skillName}: missingCount mismatch`).toBe(actualMissing);
    }
  });

  it('all orchestrate-* skills are checked for reconciliation section', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    const orchestrateResults = results.filter(r => r.category === 'orchestrate');
    expect(orchestrateResults.length).toBeGreaterThanOrEqual(4);
    for (const result of orchestrateResults) {
      const report = interpretSkillQuality(result);
      const sectionAssessments = report.assessments.filter(
        a => a.kind === 'SECTION_COMPLETE' || a.kind === 'MISSING_SECTION',
      );
      expect(sectionAssessments.length, `${result.skillName} has no section assessments`).toBeGreaterThan(0);
    }
  });
});
