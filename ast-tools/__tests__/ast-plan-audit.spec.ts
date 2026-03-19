import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzePlan } from '../ast-plan-audit';
import type { PlanAuditObservation } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(__dirname, 'fixtures/plan-audit');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

function promptFixturePath(name: string): string {
  return path.join(FIXTURES_DIR, 'prompts', name);
}

function findByKind(observations: readonly PlanAuditObservation[], kind: string): PlanAuditObservation[] {
  return observations.filter(o => o.kind === kind);
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('ast-plan-audit', () => {
  describe('header checks', () => {
    it('passes when all required headers are present', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const missing = findByKind(result.observations, 'PLAN_HEADER_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects missing required headers', () => {
      const result = analyzePlan(fixturePath('plan-structural-issues.md'));
      const missing = findByKind(result.observations, 'PLAN_HEADER_MISSING');
      const missingFields = missing.map(o => o.evidence.field);

      expect(missingFields).toContain('Complexity');
      expect(missingFields).toContain('Duration');
      expect(missingFields).toContain('Nearest');
      expect(missingFields).toContain('Created');
      // Branch IS present in the fixture
      expect(missingFields).not.toContain('Branch');
    });

    it('detects invalid Complexity format', () => {
      const result = analyzePlan(fixturePath('plan-invalid-formats.md'));
      const invalid = findByKind(result.observations, 'PLAN_HEADER_INVALID');
      const complexityObs = invalid.find(o => o.evidence.field === 'Complexity');

      expect(complexityObs?.evidence.value).toBe('high');
    });

    it('detects invalid Duration format', () => {
      const result = analyzePlan(fixturePath('plan-invalid-formats.md'));
      const invalid = findByKind(result.observations, 'PLAN_HEADER_INVALID');
      const durationObs = invalid.find(o => o.evidence.field === 'Duration');

      expect(durationObs?.evidence.value).toBe('about 12 hours');
    });

    it('passes valid Complexity and Duration formats', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const invalid = findByKind(result.observations, 'PLAN_HEADER_INVALID');
      expect(invalid).toHaveLength(0);
    });
  });

  describe('pre-flight mark', () => {
    it('emits PRE_FLIGHT_CERTIFIED when mark is present', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const certified = findByKind(result.observations, 'PRE_FLIGHT_CERTIFIED');

      expect(certified).toHaveLength(1);
      expect(certified[0].evidence.certificationTier).toBe('CERTIFIED');
      expect(certified[0].evidence.certificationDate).toBe('2026-03-15');
    });

    it('emits PRE_FLIGHT_CONDITIONAL for CONDITIONAL tier', () => {
      const result = analyzePlan(fixturePath('plan-conditional.md'));
      const conditional = findByKind(result.observations, 'PRE_FLIGHT_CONDITIONAL');

      expect(conditional).toHaveLength(1);
      expect(conditional[0].evidence.certificationTier).toBe('CONDITIONAL');
      expect(conditional[0].evidence.certificationDate).toBe('2026-03-14');
    });

    it('emits PRE_FLIGHT_MARK_MISSING when no mark', () => {
      const result = analyzePlan(fixturePath('plan-structural-issues.md'));
      const missing = findByKind(result.observations, 'PRE_FLIGHT_MARK_MISSING');
      expect(missing).toHaveLength(1);
    });
  });

  describe('verification block', () => {
    it('passes when verification heading exists', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const missing = findByKind(result.observations, 'VERIFICATION_BLOCK_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects missing verification block', () => {
      const result = analyzePlan(fixturePath('plan-structural-issues.md'));
      const missing = findByKind(result.observations, 'VERIFICATION_BLOCK_MISSING');
      expect(missing).toHaveLength(1);
    });

    it('recognizes "Verification Checklist" heading', () => {
      const result = analyzePlan(fixturePath('plan-invalid-formats.md'));
      const missing = findByKind(result.observations, 'VERIFICATION_BLOCK_MISSING');
      expect(missing).toHaveLength(0);
    });
  });

  describe('cleanup reference', () => {
    it('passes when cleanup file is referenced', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const missing = findByKind(result.observations, 'CLEANUP_FILE_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects missing cleanup reference', () => {
      const result = analyzePlan(fixturePath('plan-structural-issues.md'));
      const missing = findByKind(result.observations, 'CLEANUP_FILE_MISSING');
      expect(missing).toHaveLength(1);
    });
  });

  describe('prompt table', () => {
    it('parses prompt table and validates modes', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const modeUnset = findByKind(result.observations, 'PROMPT_MODE_UNSET');
      expect(modeUnset).toHaveLength(0);
    });

    it('detects unset prompt modes', () => {
      const result = analyzePlan(fixturePath('plan-mode-unset.md'));
      const modeUnset = findByKind(result.observations, 'PROMPT_MODE_UNSET');

      // Row 02 has empty mode, row 03 has "complex" which is not auto/manual
      expect(modeUnset).toHaveLength(2);
      const promptNames = modeUnset.map(o => o.evidence.promptName);
      expect(promptNames).toContain('second');
      expect(promptNames).toContain('third');
    });

    it('detects dependency cycles', () => {
      const result = analyzePlan(fixturePath('plan-dependency-cycle.md'));
      const cycles = findByKind(result.observations, 'PROMPT_DEPENDENCY_CYCLE');

      expect(cycles).toHaveLength(1);
      expect(cycles[0].evidence.cyclePath?.length).toBeGreaterThan(2);
    });

    it('passes when no dependency cycles exist', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const cycles = findByKind(result.observations, 'PROMPT_DEPENDENCY_CYCLE');
      expect(cycles).toHaveLength(0);
    });
  });

  describe('prompt file existence', () => {
    it('detects missing prompt files when prompts are provided', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [
        promptFixturePath('plan-valid-01-first-prompt.md'),
        // 02 and 03 are missing
      ]);
      const missing = findByKind(result.observations, 'PROMPT_FILE_MISSING');

      expect(missing).toHaveLength(2);
      const descriptions = missing.map(o => o.evidence.promptFile);
      expect(descriptions).toContainEqual(expect.stringContaining('02'));
      expect(descriptions).toContainEqual(expect.stringContaining('03'));
    });

    it('passes when all prompt files exist', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [
        promptFixturePath('plan-valid-01-first-prompt.md'),
        promptFixturePath('plan-valid-02-second-prompt.md'),
        promptFixturePath('plan-valid-03-third-prompt.md'),
      ]);
      const missing = findByKind(result.observations, 'PROMPT_FILE_MISSING');
      expect(missing).toHaveLength(0);
    });
  });

  describe('prompt verification', () => {
    it('passes when prompt has verification heading with code block', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [promptFixturePath('plan-valid-01-first-prompt.md')]);
      const missing = findByKind(result.observations, 'PROMPT_VERIFICATION_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects prompt without verification heading', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [promptFixturePath('prompt-no-verification.md')]);
      const missing = findByKind(result.observations, 'PROMPT_VERIFICATION_MISSING');
      expect(missing).toHaveLength(1);
    });

    it('detects verification heading without code block', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [promptFixturePath('prompt-empty-verification.md')]);
      const missing = findByKind(result.observations, 'PROMPT_VERIFICATION_MISSING');
      expect(missing).toHaveLength(1);
    });
  });

  describe('reconciliation template', () => {
    it('passes when prompt has reconciliation reference', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [promptFixturePath('plan-valid-01-first-prompt.md')]);
      const missing = findByKind(result.observations, 'RECONCILIATION_TEMPLATE_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects prompt without reconciliation reference', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), [promptFixturePath('prompt-no-reconciliation.md')]);
      const missing = findByKind(result.observations, 'RECONCILIATION_TEMPLATE_MISSING');
      expect(missing).toHaveLength(1);
    });
  });

  describe('standing elements', () => {
    it('passes when all standing elements have values', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      const missing = findByKind(result.observations, 'STANDING_ELEMENT_MISSING');
      expect(missing).toHaveLength(0);
    });

    it('detects standing elements without Yes/No/N/A values', () => {
      const result = analyzePlan(fixturePath('plan-standing-incomplete.md'));
      const missing = findByKind(result.observations, 'STANDING_ELEMENT_MISSING');

      // "DEAD CODE PASS" has "pending review" and "IMPORT BOUNDARY CHECK" has empty value
      expect(missing).toHaveLength(2);
      const names = missing.map(o => o.evidence.elementName);
      expect(names).toContain('DEAD CODE PASS');
      expect(names).toContain('IMPORT BOUNDARY CHECK');
    });
  });

  describe('convention observations', () => {
    it('detects naming convention instructions', () => {
      const result = analyzePlan(fixturePath('plan-conventions.md'));
      const naming = findByKind(result.observations, 'NAMING_CONVENTION_INSTRUCTION');
      expect(naming).toHaveLength(1);
      expect(naming[0].evidence.instruction).toContain('camelCase');
    });

    it('detects client-side aggregation patterns', () => {
      const result = analyzePlan(fixturePath('plan-conventions.md'));
      const aggregation = findByKind(result.observations, 'CLIENT_SIDE_AGGREGATION');
      expect(aggregation).toHaveLength(1);
    });

    it('detects deferred cleanup references', () => {
      const result = analyzePlan(fixturePath('plan-conventions.md'));
      const deferred = findByKind(result.observations, 'DEFERRED_CLEANUP_REFERENCE');
      expect(deferred).toHaveLength(1);
    });

    it('detects file path references', () => {
      const result = analyzePlan(fixturePath('plan-conventions.md'));
      const paths = findByKind(result.observations, 'FILE_PATH_REFERENCE');
      const referencedPaths = paths.map(o => o.evidence.referencedPath);
      expect(referencedPaths).toContain('src/ui/services/hooks/useMyHook.ts');
    });

    it('detects skill references', () => {
      const result = analyzePlan(fixturePath('plan-conventions.md'));
      const skills = findByKind(result.observations, 'SKILL_REFERENCE');
      const skillNames = skills.map(o => o.evidence.skillName);
      expect(skillNames).toContain('/refactor-react-hook');
    });
  });

  describe('analyzePlan return shape', () => {
    it('returns filePath and observations array', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      expect(result.filePath).toBeDefined();
      expect(Array.isArray(result.observations)).toBe(true);
    });

    it('every observation has kind, file, line, evidence', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'));
      for (const obs of result.observations) {
        expect(obs.kind).toBeDefined();
        expect(typeof obs.kind).toBe('string');
        expect(obs.file).toBeDefined();
        expect(typeof obs.line).toBe('number');
        expect(obs.evidence).toBeDefined();
      }
    });
  });

  describe('edge cases', () => {
    it('handles plan with no prompt table', () => {
      const result = analyzePlan(fixturePath('plan-structural-issues.md'));
      // Should not throw -- just skip table checks
      const modeUnset = findByKind(result.observations, 'PROMPT_MODE_UNSET');
      expect(modeUnset).toHaveLength(0);
    });

    it('handles empty prompt paths array', () => {
      const result = analyzePlan(fixturePath('plan-valid.md'), []);
      // Should not throw -- just skip prompt file checks
      const promptMissing = findByKind(result.observations, 'PROMPT_FILE_MISSING');
      expect(promptMissing).toHaveLength(0);
    });
  });
});
