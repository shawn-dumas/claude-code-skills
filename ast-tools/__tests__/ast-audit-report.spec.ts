import { describe, it, expect } from 'vitest';
import { renderJson, renderMarkdownSummary, computeDiff, renderDiff, type AuditMetadata } from '../ast-audit-report';
import type { Finding } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'abc123',
    kind: 'as-any',
    priority: 'P4',
    category: 'Bug',
    file: 'src/ui/Foo.tsx',
    line: 10,
    evidence: 'AS_ANY_CAST at src/ui/Foo.tsx:10',
    rationale: ['AS_ANY_CAST'],
    confidence: 'high',
    source: 'type-safety',
    astConfirmed: true,
    track: 'fe',
    ...overrides,
  };
}

const META: AuditMetadata = {
  timestamp: '2026-03-23T00:00:00Z',
  branch: 'sd/productionize',
  head: 'abc1234',
  targetPaths: ['src/'],
  filesScanned: 420,
  observationCount: 5000,
  assessmentCount: 200,
  durationMs: 45000,
  cacheHits: 4000,
  cacheMisses: 1000,
};

// ---------------------------------------------------------------------------
// renderJson
// ---------------------------------------------------------------------------

describe('renderJson', () => {
  it('produces valid JSON', () => {
    const json = renderJson([finding()]);
    const parsed = JSON.parse(json) as Finding[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].kind).toBe('as-any');
  });

  it('handles empty findings', () => {
    const json = renderJson([]);
    expect(JSON.parse(json)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// renderMarkdownSummary
// ---------------------------------------------------------------------------

describe('renderMarkdownSummary', () => {
  it('contains header fields', () => {
    const md = renderMarkdownSummary([finding()], META);
    expect(md).toContain('# AST Audit Report');
    expect(md).toContain('sd/productionize');
    expect(md).toContain('abc1234');
    expect(md).toContain('420');
    expect(md).toContain('45.0s');
  });

  it('contains summary table with correct counts', () => {
    const findings = [
      finding({ id: 'a', priority: 'P1', category: 'Bug' }),
      finding({ id: 'b', priority: 'P3', category: 'Architecture', kind: 'dead-export' }),
      finding({ id: 'c', priority: 'P4', category: 'Bug' }),
    ];
    const md = renderMarkdownSummary(findings, META);
    expect(md).toContain('## Summary');
    expect(md).toContain('| Category |');
    expect(md).toContain('**3**');
  });

  it('renders critical findings section for P1-P2', () => {
    const findings = [
      finding({ id: 'a', priority: 'P1', kind: 'RAW_ROLE_CHECK' }),
      finding({ id: 'b', priority: 'P4' }),
    ];
    const md = renderMarkdownSummary(findings, META);
    expect(md).toContain('## Critical Findings (P1-P2)');
    expect(md).toContain('RAW_ROLE_CHECK');
  });

  it('omits critical section when no P1-P2 findings', () => {
    const findings = [finding({ priority: 'P4' })];
    const md = renderMarkdownSummary(findings, META);
    expect(md).not.toContain('## Critical Findings');
  });

  it('renders per-file breakdown for files with 3+ findings', () => {
    const findings = [
      finding({ id: 'a', file: 'src/hot.tsx', line: 1 }),
      finding({ id: 'b', file: 'src/hot.tsx', line: 2, kind: 'non-null-assertion' }),
      finding({ id: 'c', file: 'src/hot.tsx', line: 3, kind: 'complexity-hotspot', category: 'Architecture' }),
    ];
    const md = renderMarkdownSummary(findings, META);
    expect(md).toContain('## Per-File Breakdown');
    expect(md).toContain('src/hot.tsx (3 findings)');
  });

  it('renders track summary', () => {
    const findings = [finding({ id: 'a', track: 'fe' }), finding({ id: 'b', track: 'bff', file: 'src/server/x.ts' })];
    const md = renderMarkdownSummary(findings, META);
    expect(md).toContain('## Track Summary');
    expect(md).toContain('| FE |');
    expect(md).toContain('| BFF |');
  });

  it('handles empty findings', () => {
    const md = renderMarkdownSummary([], META);
    expect(md).toContain('**Findings**: 0');
    expect(md).toContain('**0**');
  });
});

// ---------------------------------------------------------------------------
// computeDiff
// ---------------------------------------------------------------------------

describe('computeDiff', () => {
  it('identifies new findings', () => {
    const current = [finding({ id: 'new1' })];
    const previous: Finding[] = [];
    const diff = computeDiff(current, previous);
    expect(diff.added).toHaveLength(1);
    expect(diff.resolved).toHaveLength(0);
  });

  it('identifies resolved findings', () => {
    const current: Finding[] = [];
    const previous = [finding({ id: 'old1' })];
    const diff = computeDiff(current, previous);
    expect(diff.resolved).toHaveLength(1);
    expect(diff.added).toHaveLength(0);
  });

  it('identifies changed priority', () => {
    const current = [finding({ id: 'same', priority: 'P2' })];
    const previous = [finding({ id: 'same', priority: 'P4' })];
    const diff = computeDiff(current, previous);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].previous.priority).toBe('P4');
    expect(diff.changed[0].current.priority).toBe('P2');
  });

  it('ignores unchanged findings', () => {
    const f = finding({ id: 'stable' });
    const diff = computeDiff([f], [f]);
    expect(diff.added).toHaveLength(0);
    expect(diff.resolved).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// renderDiff
// ---------------------------------------------------------------------------

describe('renderDiff', () => {
  it('renders counts in header', () => {
    const diff = computeDiff([finding({ id: 'new1' })], [finding({ id: 'old1' })]);
    const md = renderDiff(diff);
    expect(md).toContain('**New findings**: 1');
    expect(md).toContain('**Resolved findings**: 1');
  });

  it('renders empty diff cleanly', () => {
    const diff = computeDiff([], []);
    const md = renderDiff(diff);
    expect(md).toContain('**New findings**: 0');
    expect(md).not.toContain('## New Findings');
  });
});
