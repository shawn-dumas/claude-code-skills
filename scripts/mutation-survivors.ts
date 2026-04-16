#!/usr/bin/env -S npx tsx
/**
 * Extract mutation survivors from a stryker json report, grouped by
 * source line with local source context.
 *
 * Usage:
 *   npx tsx scripts/mutation-survivors.ts <target-file>
 *   npx tsx scripts/mutation-survivors.ts <target-file> --json
 *   npx tsx scripts/mutation-survivors.ts --all
 *
 * Reads from reports/mutation/mutation.json by default. Writes human-
 * readable output to stdout; pass --json for machine-readable output
 * consumed by the close-mutation-gaps skill.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

interface MutantLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

interface Mutant {
  id: string;
  mutatorName: string;
  replacement: string;
  location: MutantLocation;
  status: 'Killed' | 'Survived' | 'NoCoverage' | 'Timeout' | 'RuntimeError' | 'CompileError';
  coveredBy?: string[];
  killedBy?: string[];
  testsCompleted?: number;
  statusReason?: string;
}

interface FileReport {
  language: string;
  mutants: Mutant[];
  source: string;
}

interface MutationReport {
  schemaVersion: string;
  thresholds: { high: number; low: number };
  files: Record<string, FileReport>;
}

interface SurvivorCluster {
  line: number;
  sourceLine: string;
  sourceContext: string[];
  mutants: {
    id: string;
    mutator: string;
    replacement: string;
    column: { start: number; end: number };
    status: 'Survived' | 'NoCoverage';
  }[];
}

interface FilePlan {
  path: string;
  totalMutants: number;
  killed: number;
  survived: number;
  noCoverage: number;
  score: number;
  clusters: SurvivorCluster[];
}

function loadReport(path: string): MutationReport {
  const raw = readFileSync(resolve(path), 'utf8');
  return JSON.parse(raw) as MutationReport;
}

function planForFile(path: string, fileData: FileReport): FilePlan {
  const sourceLines = fileData.source.split('\n');
  const byLine = new Map<number, SurvivorCluster>();

  let killed = 0;
  let survived = 0;
  let noCoverage = 0;

  for (const m of fileData.mutants) {
    if (m.status === 'Killed') {
      killed++;
      continue;
    }
    if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
    if (m.status === 'Survived') survived++;
    if (m.status === 'NoCoverage') noCoverage++;

    const line = m.location.start.line;
    if (!byLine.has(line)) {
      const sourceLine = sourceLines[line - 1] ?? '';
      const contextStart = Math.max(0, line - 4);
      const contextEnd = Math.min(sourceLines.length, line + 3);
      const sourceContext = sourceLines.slice(contextStart, contextEnd).map((l, i) => {
        const num = contextStart + i + 1;
        const marker = num === line ? '>' : ' ';
        return `${marker} ${num.toString().padStart(4)}: ${l}`;
      });
      byLine.set(line, { line, sourceLine, sourceContext, mutants: [] });
    }
    byLine.get(line)!.mutants.push({
      id: m.id,
      mutator: m.mutatorName,
      replacement: m.replacement,
      column: { start: m.location.start.column, end: m.location.end.column },
      status: m.status,
    });
  }

  const clusters = [...byLine.values()].sort((a, b) => b.mutants.length - a.mutants.length);
  const total = killed + survived + noCoverage;
  const score = total > 0 ? (killed / total) * 100 : 0;
  return { path, totalMutants: total, killed, survived, noCoverage, score, clusters };
}

function renderHuman(plan: FilePlan): string {
  const out: string[] = [];
  out.push(`# ${plan.path}`);
  out.push(
    `# score: ${plan.score.toFixed(1)}% (${plan.killed} killed, ${plan.survived} survived, ${plan.noCoverage} no-cov, ${plan.totalMutants} total)`,
  );
  out.push(`# ${plan.clusters.length} survivor cluster(s) by line, sorted by cluster size`);
  out.push('');

  for (const cluster of plan.clusters) {
    out.push(`## line ${cluster.line} -- ${cluster.mutants.length} survivor(s)`);
    out.push('```');
    out.push(...cluster.sourceContext);
    out.push('```');
    out.push('mutations:');
    for (const m of cluster.mutants) {
      const col = `col ${m.column.start}-${m.column.end}`;
      const repl = m.replacement.length > 80 ? m.replacement.slice(0, 77) + '...' : m.replacement;
      out.push(`  - [${m.status}] ${m.mutator} (${col}): \`${repl}\``);
    }
    out.push('');
  }
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const reportPath = args.find(a => a.startsWith('--report='))?.slice(9) ?? 'reports/mutation/mutation.json';
  const json = args.includes('--json');
  const all = args.includes('--all');
  const targetFile = args.find(a => !a.startsWith('--'));

  if (!targetFile && !all) {
    console.error('usage: mutation-survivors.ts <target-file> [--json] [--report=path]');
    console.error('       mutation-survivors.ts --all [--json]');
    process.exit(1);
  }

  const report = loadReport(reportPath);
  const plans: FilePlan[] = [];
  for (const [path, fileData] of Object.entries(report.files)) {
    if (targetFile && !path.endsWith(targetFile) && path !== targetFile) continue;
    plans.push(planForFile(path, fileData));
  }

  if (plans.length === 0) {
    console.error(`no matching files for "${targetFile}" in ${reportPath}`);
    process.exit(1);
  }

  if (json) {
    console.log(JSON.stringify(all ? plans : plans[0], null, 2));
    return;
  }
  for (const plan of plans) {
    console.log(renderHuman(plan));
    if (plans.length > 1) console.log('');
  }
}

main();
