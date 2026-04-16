/**
 * ast-audit-report.ts -- Pure renderers for audit findings.
 *
 * No I/O, no AST infrastructure. All functions take findings + metadata
 * and return formatted strings.
 */
import type { Finding, FindingCategory } from './types';

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export interface AuditMetadata {
  readonly timestamp: string;
  readonly branch: string;
  readonly head: string;
  readonly targetPaths: readonly string[];
  readonly filesScanned: number;
  readonly observationCount: number;
  readonly assessmentCount: number;
  readonly durationMs: number;
  readonly cacheHits: number;
  readonly cacheMisses: number;
}

// ---------------------------------------------------------------------------
// JSON output
// ---------------------------------------------------------------------------

export function renderJson(findings: readonly Finding[]): string {
  return JSON.stringify(findings, null, 2);
}

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

export function renderMarkdownSummary(findings: readonly Finding[], meta: AuditMetadata): string {
  const lines: string[] = [];

  // Header
  lines.push('# AST Audit Report');
  lines.push('');
  lines.push(`**Date**: ${meta.timestamp}`);
  lines.push(`**Branch**: ${meta.branch}`);
  lines.push(`**HEAD**: ${meta.head}`);
  lines.push(`**Target**: ${meta.targetPaths.join(', ')}`);
  lines.push(`**Files scanned**: ${meta.filesScanned}`);
  lines.push(
    `**Duration**: ${(meta.durationMs / 1000).toFixed(1)}s (cache: ${meta.cacheHits} hits, ${meta.cacheMisses} misses)`,
  );
  lines.push(`**Findings**: ${findings.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Summary table
  lines.push('## Summary');
  lines.push('');
  lines.push(...renderSummaryTable(findings));
  lines.push('');

  // Top-priority findings (P1-P2)
  const critical = findings.filter(f => f.priority === 'P1' || f.priority === 'P2');
  if (critical.length > 0) {
    lines.push('## Critical Findings (P1-P2)');
    lines.push('');
    lines.push(...renderFindingsTable(critical));
    lines.push('');
  }

  // Full findings index
  lines.push('## Findings Index');
  lines.push('');
  for (const cat of ['Bug', 'Architecture', 'Testing', 'Style'] as FindingCategory[]) {
    const catFindings = findings.filter(f => f.category === cat);
    if (catFindings.length === 0) continue;
    lines.push(`### ${cat} (${catFindings.length})`);
    lines.push('');
    lines.push(...renderFindingsTable(catFindings));
    lines.push('');
  }

  // Per-file breakdown (files with 3+ findings)
  const byFile = groupByFile(findings);
  const hotFiles = [...byFile.entries()].filter(([, fs]) => fs.length >= 3).sort((a, b) => b[1].length - a[1].length);

  if (hotFiles.length > 0) {
    lines.push('## Per-File Breakdown');
    lines.push('');
    for (const [file, fileFindings] of hotFiles) {
      lines.push(`### ${file} (${fileFindings.length} findings)`);
      lines.push('');
      lines.push('| P | Line | Kind | Evidence |');
      lines.push('|---|------|------|----------|');
      for (const f of fileFindings) {
        lines.push(`| ${f.priority} | ${f.line ?? '-'} | ${f.kind} | ${f.evidence} |`);
      }
      lines.push('');
    }
  }

  // Track summary
  const feTracks = findings.filter(f => f.track === 'fe');
  const bffTracks = findings.filter(f => f.track === 'bff');
  lines.push('## Track Summary');
  lines.push('');
  lines.push(`| Track | Findings | P1 | P2 | P3 | P4 | P5 |`);
  lines.push(`|-------|----------|----|----|----|----|-----|`);
  lines.push(
    `| FE | ${feTracks.length} | ${countPriority(feTracks, 'P1')} | ${countPriority(feTracks, 'P2')} | ${countPriority(feTracks, 'P3')} | ${countPriority(feTracks, 'P4')} | ${countPriority(feTracks, 'P5')} |`,
  );
  lines.push(
    `| BFF | ${bffTracks.length} | ${countPriority(bffTracks, 'P1')} | ${countPriority(bffTracks, 'P2')} | ${countPriority(bffTracks, 'P3')} | ${countPriority(bffTracks, 'P4')} | ${countPriority(bffTracks, 'P5')} |`,
  );
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Diff report
// ---------------------------------------------------------------------------

export interface DiffResult {
  readonly added: readonly Finding[];
  readonly resolved: readonly Finding[];
  readonly changed: readonly { previous: Finding; current: Finding }[];
}

export function computeDiff(current: readonly Finding[], previous: readonly Finding[]): DiffResult {
  const prevById = new Map(previous.map(f => [f.id, f]));
  const currById = new Map(current.map(f => [f.id, f]));

  const added: Finding[] = [];
  const resolved: Finding[] = [];
  const changed: { previous: Finding; current: Finding }[] = [];

  for (const f of current) {
    const prev = prevById.get(f.id);
    if (!prev) {
      added.push(f);
    } else if (prev.priority !== f.priority) {
      changed.push({ previous: prev, current: f });
    }
  }

  for (const f of previous) {
    if (!currById.has(f.id)) {
      resolved.push(f);
    }
  }

  return { added, resolved, changed };
}

export function renderDiff(diff: DiffResult): string {
  const lines: string[] = [];

  lines.push('# Audit Diff Report');
  lines.push('');
  lines.push(`**New findings**: ${diff.added.length}`);
  lines.push(`**Resolved findings**: ${diff.resolved.length}`);
  lines.push(`**Changed priority**: ${diff.changed.length}`);
  lines.push('');

  if (diff.added.length > 0) {
    lines.push('## New Findings');
    lines.push('');
    lines.push(...renderFindingsTable(diff.added));
    lines.push('');
  }

  if (diff.resolved.length > 0) {
    lines.push('## Resolved Findings');
    lines.push('');
    lines.push(...renderFindingsTable(diff.resolved));
    lines.push('');
  }

  if (diff.changed.length > 0) {
    lines.push('## Changed Priority');
    lines.push('');
    lines.push('| File | Kind | Was | Now | Evidence |');
    lines.push('|------|------|-----|-----|----------|');
    for (const { previous, current } of diff.changed) {
      lines.push(
        `| ${current.file}:${current.line ?? '-'} | ${current.kind} | ${previous.priority} | ${current.priority} | ${current.evidence} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSummaryTable(findings: readonly Finding[]): string[] {
  const categories: FindingCategory[] = ['Bug', 'Architecture', 'Testing', 'Style'];
  const priorities = ['P1', 'P2', 'P3', 'P4', 'P5'] as const;

  const lines: string[] = [];
  lines.push('| Category | P1 | P2 | P3 | P4 | P5 | Total |');
  lines.push('|----------|----|----|----|----|-----|-------|');

  let grandTotal = 0;
  const colTotals = [0, 0, 0, 0, 0];

  for (const cat of categories) {
    const catFindings = findings.filter(f => f.category === cat);
    const counts = priorities.map(p => catFindings.filter(f => f.priority === p).length);
    const total = counts.reduce((a, b) => a + b, 0);
    grandTotal += total;
    counts.forEach((c, i) => (colTotals[i] += c));
    lines.push(`| ${cat} | ${counts.join(' | ')} | ${total} |`);
  }

  lines.push(`| **Total** | ${colTotals.join(' | ')} | **${grandTotal}** |`);
  return lines;
}

function renderFindingsTable(findings: readonly Finding[]): string[] {
  const lines: string[] = [];
  lines.push('| P | File | Track | Kind | Evidence | Source |');
  lines.push('|---|------|-------|------|----------|--------|');
  for (const f of findings) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    lines.push(`| ${f.priority} | ${loc} | ${f.track} | ${f.kind} | ${f.evidence} | ${f.source} |`);
  }
  return lines;
}

function groupByFile(findings: readonly Finding[]): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const f of findings) {
    const list = map.get(f.file);
    if (list) {
      list.push(f);
    } else {
      map.set(f.file, [f]);
    }
  }
  return map;
}

function countPriority(findings: readonly Finding[], priority: string): number {
  return findings.filter(f => f.priority === priority).length;
}
