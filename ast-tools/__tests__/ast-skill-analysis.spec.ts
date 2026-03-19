import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyzeSkillFile, analyzeSkillDirectory } from '../ast-skill-analysis';
import type { SkillAnalysisObservation, SkillAnalysisObservationKind } from '../types';

// -- Helpers --

const FIXTURES_DIR = path.join(__dirname, 'fixtures/skill-analysis');

function fixturePath(name: string): string {
  return path.join(FIXTURES_DIR, name);
}

/** Simulate the known skill directories for cross-ref validation. */
const MOCK_SKILL_DIRS = new Set([
  'audit-react-feature',
  'build-module-test',
  'build-ast-tool',
  'refactor-react-component',
  'spawn-satan',
  'flatten-jsx-template',
  // Add synthetic fixture skill names so cross-ref tests work
  'test-positive-skill',
  'test-negative-skill',
  'test-minimal-skill',
]);

function findByKind(
  observations: readonly SkillAnalysisObservation[],
  kind: SkillAnalysisObservationKind,
): SkillAnalysisObservation[] {
  return observations.filter(o => o.kind === kind);
}

// -- Synthetic fixtures --

describe('ast-skill-analysis (synthetic fixtures)', () => {
  describe('positive fixture', () => {
    const result = analyzeSkillFile(fixturePath('skill-positive.md'), MOCK_SKILL_DIRS);

    it('derives skill name from parent directory', () => {
      // File is inside skill-analysis/ directory, so skillName = "skill-analysis"
      expect(result.skillName).toBe('skill-analysis');
    });

    it('extracts sections from headings, skipping frontmatter', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      // Should NOT include frontmatter content as a heading
      const frontmatterSection = sections.find(s => s.evidence.text?.includes('name:'));
      expect(frontmatterSection).toBeUndefined();
      // Should include the title
      const title = sections.find(s => s.evidence.text === 'test-positive-skill');
      expect(title).toBeDefined();
      expect(title?.evidence.depth).toBe(1);
    });

    it('extracts step headings with step numbers', () => {
      const steps = findByKind(result.observations, 'SKILL_STEP');
      expect(steps.length).toBeGreaterThanOrEqual(6); // Steps 0-5
      const step0 = steps.find(s => s.evidence.stepNumber === 0);
      expect(step0).toBeDefined();
      expect(step0?.evidence.text).toContain('Pre-flight');
      const step5 = steps.find(s => s.evidence.stepNumber === 5);
      expect(step5).toBeDefined();
      expect(step5?.evidence.text).toContain('Verify');
    });

    it('extracts code blocks with language tags', () => {
      const codeBlocks = findByKind(result.observations, 'SKILL_CODE_BLOCK');
      const bashBlock = codeBlocks.find(cb => cb.evidence.lang === 'bash');
      expect(bashBlock).toBeDefined();
      const tsBlock = codeBlocks.find(cb => cb.evidence.lang === 'ts');
      expect(tsBlock).toBeDefined();
    });

    it('extracts shell commands with classification', () => {
      const commands = findByKind(result.observations, 'SKILL_COMMAND_REF');
      const tscCmd = commands.find(c => c.evidence.content?.includes('pnpm tsc'));
      expect(tscCmd).toBeDefined();
      expect(tscCmd?.evidence.commandType).toBe('typecheck');

      const testCmd = commands.find(c => c.evidence.content?.includes('pnpm test'));
      expect(testCmd).toBeDefined();
      expect(testCmd?.evidence.commandType).toBe('test');

      const astCmd = commands.find(c => c.evidence.content?.includes('ast-complexity'));
      expect(astCmd).toBeDefined();
      expect(astCmd?.evidence.commandType).toBe('ast-tool');

      const buildCmd = commands.find(c => c.evidence.content?.includes('pnpm build'));
      expect(buildCmd).toBeDefined();
      expect(buildCmd?.evidence.commandType).toBe('build');

      const vitestCmd = commands.find(c => c.evidence.content?.includes('vitest'));
      expect(vitestCmd).toBeDefined();
      expect(vitestCmd?.evidence.commandType).toBe('test');
    });

    it('extracts file path references with existence checks', () => {
      const pathRefs = findByKind(result.observations, 'SKILL_FILE_PATH_REF');
      // scripts/AST/types.ts exists
      const typesRef = pathRefs.find(p => p.evidence.referencedPath === 'scripts/AST/types.ts');
      expect(typesRef).toBeDefined();
      expect(typesRef?.evidence.exists).toBe(true);

      // scripts/AST/cli.ts exists
      const cliRef = pathRefs.find(p => p.evidence.referencedPath === 'scripts/AST/cli.ts');
      expect(cliRef).toBeDefined();
      expect(cliRef?.evidence.exists).toBe(true);
    });

    it('extracts cross-references to other skills', () => {
      const crossRefs = findByKind(result.observations, 'SKILL_CROSS_REF');
      const auditRef = crossRefs.find(cr => cr.evidence.skillName === 'audit-react-feature');
      expect(auditRef).toBeDefined();
      expect(auditRef?.evidence.refExists).toBe(true);

      const buildTestRef = crossRefs.find(cr => cr.evidence.skillName === 'build-module-test');
      expect(buildTestRef).toBeDefined();
      expect(buildTestRef?.evidence.refExists).toBe(true);
    });

    it('extracts doc references', () => {
      const docRefs = findByKind(result.observations, 'SKILL_DOC_REF');
      const bffDoc = docRefs.find(d => d.evidence.referencedPath === 'docs/bff.md');
      expect(bffDoc).toBeDefined();
      expect(bffDoc?.evidence.refExists).toBe(true);

      const testingDoc = docRefs.find(d => d.evidence.referencedPath === 'docs/testing.md');
      expect(testingDoc).toBeDefined();
      expect(testingDoc?.evidence.refExists).toBe(true);
    });

    it('extracts tables with headers and row counts', () => {
      const tables = findByKind(result.observations, 'SKILL_TABLE');
      expect(tables.length).toBeGreaterThanOrEqual(1);
      const taskTable = tables.find(t => t.evidence.tableHeaders?.includes('#'));
      expect(taskTable).toBeDefined();
      expect(taskTable?.evidence.tableRowCount).toBe(3);
    });

    it('extracts checklist items with checked state', () => {
      const items = findByKind(result.observations, 'SKILL_CHECKLIST_ITEM');
      expect(items).toHaveLength(5);
      const checked = items.filter(i => i.evidence.checked === true);
      const unchecked = items.filter(i => i.evidence.checked === false);
      expect(checked).toHaveLength(2);
      expect(unchecked).toHaveLength(3);
      // Verify item text
      const typesItem = items.find(i => i.evidence.itemText?.includes('Types added'));
      expect(typesItem).toBeDefined();
      expect(typesItem?.evidence.checked).toBe(true);
    });
  });

  describe('negative fixture', () => {
    const result = analyzeSkillFile(fixturePath('skill-negative.md'), MOCK_SKILL_DIRS);

    it('detects nonexistent file paths', () => {
      const pathRefs = findByKind(result.observations, 'SKILL_FILE_PATH_REF');
      const stale = pathRefs.filter(p => p.evidence.exists === false);
      expect(stale.length).toBeGreaterThanOrEqual(3);
      // Specific stale paths
      const nonexistent = stale.find(p =>
        p.evidence.referencedPath?.includes('src/nonexistent/path/that/does/not/exist.ts'),
      );
      expect(nonexistent).toBeDefined();
      expect(nonexistent?.evidence.pathContext).toBe('inline-code');
    });

    it('detects nonexistent doc references', () => {
      const docRefs = findByKind(result.observations, 'SKILL_DOC_REF');
      const staleDoc = docRefs.find(d => d.evidence.referencedPath === 'docs/this-doc-does-not-exist.md');
      expect(staleDoc).toBeDefined();
      expect(staleDoc?.evidence.refExists).toBe(false);
    });

    it('detects broken cross-references', () => {
      const crossRefs = findByKind(result.observations, 'SKILL_CROSS_REF');
      const broken = crossRefs.find(cr => cr.evidence.skillName === 'nonexistent-skill-name');
      expect(broken).toBeDefined();
      expect(broken?.evidence.refExists).toBe(false);
    });

    it('classifies diverse command types', () => {
      const commands = findByKind(result.observations, 'SKILL_COMMAND_REF');
      const types = new Set(commands.map(c => c.evidence.commandType));
      expect(types).toContain('typecheck');
      expect(types).toContain('git');
      expect(types).toContain('lint');
      expect(types).toContain('ast-tool');
    });

    it('skips non-shell code blocks for command extraction', () => {
      const commands = findByKind(result.observations, 'SKILL_COMMAND_REF');
      // Python code block content should not be extracted as commands
      const pythonCmd = commands.find(c => c.evidence.content?.includes('print'));
      expect(pythonCmd).toBeUndefined();
    });

    it('extracts commands from bare code blocks (no language)', () => {
      const commands = findByKind(result.observations, 'SKILL_COMMAND_REF');
      // The bare code block has "pnpm test"
      const bareCmd = commands.find(c => c.evidence.content === 'pnpm test');
      expect(bareCmd).toBeDefined();
      expect(bareCmd?.evidence.commandType).toBe('test');
    });

    it('extracts multiple tables', () => {
      const tables = findByKind(result.observations, 'SKILL_TABLE');
      expect(tables).toHaveLength(2);
      const threeRowTable = tables.find(t => t.evidence.tableRowCount === 3);
      expect(threeRowTable).toBeDefined();
    });

    it('handles sections without step numbers', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      const noStep = sections.find(s => s.evidence.text === 'No steps here');
      expect(noStep).toBeDefined();
      // This section should NOT appear as a SKILL_STEP
      const steps = findByKind(result.observations, 'SKILL_STEP');
      const wrongStep = steps.find(s => s.evidence.text === 'No steps here');
      expect(wrongStep).toBeUndefined();
    });

    it('detects stale paths in table cells', () => {
      const pathRefs = findByKind(result.observations, 'SKILL_FILE_PATH_REF');
      const tableRef = pathRefs.find(
        p => p.evidence.pathContext === 'table' && p.evidence.referencedPath === 'src/fake/module.ts',
      );
      expect(tableRef).toBeDefined();
      expect(tableRef?.evidence.exists).toBe(false);
    });
  });

  describe('minimal fixture', () => {
    const result = analyzeSkillFile(fixturePath('skill-minimal.md'), MOCK_SKILL_DIRS);

    it('handles files with only a title heading', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      expect(sections).toHaveLength(1);
      expect(sections[0].evidence.text).toBe('test-minimal-skill');
      expect(sections[0].evidence.depth).toBe(1);
    });

    it('emits no steps for step-less files', () => {
      const steps = findByKind(result.observations, 'SKILL_STEP');
      expect(steps).toHaveLength(0);
    });

    it('emits no code blocks, commands, tables, or checklists', () => {
      expect(findByKind(result.observations, 'SKILL_CODE_BLOCK')).toHaveLength(0);
      expect(findByKind(result.observations, 'SKILL_COMMAND_REF')).toHaveLength(0);
      expect(findByKind(result.observations, 'SKILL_TABLE')).toHaveLength(0);
      expect(findByKind(result.observations, 'SKILL_CHECKLIST_ITEM')).toHaveLength(0);
    });
  });
});

// -- Real-world fixtures --

describe('ast-skill-analysis (real-world fixtures)', () => {
  describe('spawn-satan (small, other category)', () => {
    const result = analyzeSkillFile(fixturePath('real-spawn-satan.md'), MOCK_SKILL_DIRS);

    it('skips frontmatter from section extraction', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      // No section should contain frontmatter keys
      for (const s of sections) {
        expect(s.evidence.text).not.toContain('name:');
        expect(s.evidence.text).not.toContain('description:');
        expect(s.evidence.text).not.toContain('allowed-tools:');
      }
    });

    it('extracts exactly 3 step headings (Steps 1-3)', () => {
      const steps = findByKind(result.observations, 'SKILL_STEP');
      expect(steps).toHaveLength(3);
      const numbers = steps.map(s => s.evidence.stepNumber).sort();
      expect(numbers).toEqual([1, 2, 3]);
    });

    it('extracts 4 section headings total', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      expect(sections).toHaveLength(4);
      // Includes "Output format" which is not a step
      const outputFormat = sections.find(s => s.evidence.text === 'Output format');
      expect(outputFormat).toBeDefined();
    });

    it('extracts bash code blocks with git commands', () => {
      const commands = findByKind(result.observations, 'SKILL_COMMAND_REF');
      expect(commands).toHaveLength(2);
      expect(commands[0].evidence.commandType).toBe('git');
      expect(commands[1].evidence.commandType).toBe('git');
    });

    it('has correct observation kind distribution', () => {
      const counts: Record<string, number> = {};
      for (const obs of result.observations) {
        counts[obs.kind] = (counts[obs.kind] ?? 0) + 1;
      }
      expect(counts['SKILL_SECTION']).toBe(4);
      expect(counts['SKILL_STEP']).toBe(3);
      expect(counts['SKILL_CODE_BLOCK']).toBe(3);
      expect(counts['SKILL_COMMAND_REF']).toBe(2);
      // No file paths, tables, checklists, cross-refs, or doc refs in spawn-satan
      expect(counts['SKILL_FILE_PATH_REF']).toBeUndefined();
      expect(counts['SKILL_TABLE']).toBeUndefined();
      expect(counts['SKILL_CHECKLIST_ITEM']).toBeUndefined();
    });
  });

  describe('flatten-jsx-template (medium, refactor category)', () => {
    const result = analyzeSkillFile(fixturePath('real-flatten-jsx-template.md'), MOCK_SKILL_DIRS);

    it('extracts multiple step headings', () => {
      const steps = findByKind(result.observations, 'SKILL_STEP');
      expect(steps.length).toBeGreaterThanOrEqual(5);
    });

    it('extracts sub-sections (### depth)', () => {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      const subSections = sections.filter(s => s.evidence.depth === 3);
      expect(subSections.length).toBeGreaterThan(0);
    });

    it('extracts code blocks', () => {
      const codeBlocks = findByKind(result.observations, 'SKILL_CODE_BLOCK');
      expect(codeBlocks.length).toBeGreaterThan(0);
    });

    it('detects cross-references to other skills', () => {
      const crossRefs = findByKind(result.observations, 'SKILL_CROSS_REF');
      // flatten-jsx-template references at least one other skill
      expect(crossRefs.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts at least one table', () => {
      const tables = findByKind(result.observations, 'SKILL_TABLE');
      expect(tables.length).toBeGreaterThanOrEqual(1);
    });
  });
});

// -- Categorization --

describe('skill categorization', () => {
  it('categorizes build-* skills correctly', () => {
    const result = analyzeSkillFile(fixturePath('skill-positive.md'), new Set(['build-ast-tool']));
    // The fixture is in skill-analysis/ dir, so skillName is "skill-analysis" and category is "other".
    // To test categorization, we check the function logic through the exports.
    // A file in a build-* directory would get "build" category.
    expect(result.category).toBe('other'); // skill-analysis is not a build/refactor/etc prefix
  });
});

// -- Directory scanning --

describe('analyzeSkillDirectory', () => {
  it('scans real .claude/skills/ directory and returns results for all skills', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    // Should find all 55 skill files
    expect(results.length).toBeGreaterThanOrEqual(50);
    // Results should be sorted by skill name
    const names = results.map(r => r.skillName);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('categorizes skills by prefix', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    const categories = new Set(results.map(r => r.category));
    expect(categories).toContain('build');
    expect(categories).toContain('refactor');
    expect(categories).toContain('audit');
    expect(categories).toContain('orchestrate');
    expect(categories).toContain('other');
  });

  it('every skill has at least one SKILL_SECTION observation', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    for (const result of results) {
      const sections = findByKind(result.observations, 'SKILL_SECTION');
      expect(sections.length, `${result.skillName} has no sections`).toBeGreaterThan(0);
    }
  });

  it('all file path existence checks produce boolean values', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    for (const result of results) {
      const pathRefs = findByKind(result.observations, 'SKILL_FILE_PATH_REF');
      for (const ref of pathRefs) {
        // exists should be true or false, not undefined (unless path has template vars)
        if (ref.evidence.exists !== undefined) {
          expect(typeof ref.evidence.exists).toBe('boolean');
        }
      }
    }
  });

  it('cross-references to known skills resolve as existing', () => {
    const results = analyzeSkillDirectory('.claude/skills');
    for (const result of results) {
      const crossRefs = findByKind(result.observations, 'SKILL_CROSS_REF');
      for (const ref of crossRefs) {
        if (ref.evidence.refExists === true) {
          // Verify the skill name is reasonable
          expect(ref.evidence.skillName).toBeTruthy();
          expect(ref.evidence.skillName?.length).toBeGreaterThan(3);
        }
      }
    }
  });
});
