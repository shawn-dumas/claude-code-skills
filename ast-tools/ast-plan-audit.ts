/**
 * ast-plan-audit.ts
 *
 * MDAST-based tool that parses orchestration plan and prompt markdown files
 * and emits structural and convention observations.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-plan-audit.ts <plan-file> [--prompts '<glob>'] [--pretty] [--kind <KIND>] [--count]
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { parseArgs, outputFiltered, fatal } from './cli';
import type {
  PlanAuditObservation,
  PlanAuditObservationKind,
  PlanAuditObservationEvidence,
  PlanAuditResult,
} from './types';

// --- Minimal MDAST node interface ---

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  lang?: string;
  position?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

// --- Helpers ---

function nodeText(node: MdNode): string {
  return mdastToString(node as Parameters<typeof mdastToString>[0]);
}

function nodeLine(node: MdNode): number {
  return node.position?.start.line ?? 0;
}

function walk(node: MdNode, cb: (n: MdNode) => void): void {
  cb(node);
  if (node.children) {
    for (const child of node.children) walk(child, cb);
  }
}

function findAll(tree: MdNode, type: string): MdNode[] {
  const result: MdNode[] = [];
  walk(tree, (n) => { if (n.type === type) result.push(n); });
  return result;
}

function emit(
  obs: PlanAuditObservation[],
  kind: PlanAuditObservationKind,
  file: string,
  line: number,
  evidence: PlanAuditObservationEvidence,
): void {
  obs.push({ kind, file, line, evidence });
}

// --- Header parsing (raw text, simpler than navigating MDAST blockquote nodes) ---

interface HeaderField {
  name: string;
  value: string;
  line: number;
}

function parseBlockquoteHeader(content: string): HeaderField[] {
  const lines = content.split('\n');
  const fields: HeaderField[] = [];
  let started = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*>/.test(line)) {
      started = true;
      const stripped = line.replace(/^\s*>\s?/, '');
      const m = stripped.match(/^([A-Za-z][A-Za-z\s-]*?):\s*(.+)$/);
      if (m) {
        fields.push({ name: m[1].trim(), value: m[2].trim(), line: i + 1 });
      }
    } else if (started) {
      break;
    }
  }
  return fields;
}

// --- Prompt table parsing (raw text, since tables are GFM and need extensions in MDAST) ---

interface PromptTableRow {
  number: string;
  name: string;
  mode: string;
  dependsOn: string[];
  line: number;
}

function parsePromptTable(content: string): PromptTableRow[] | null {
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (!lines[i].trim().startsWith('|')) { i++; continue; }

    // Potential table start
    const headerCells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
    const headerLower = headerCells.map(h => h.toLowerCase());
    const promptIdx = headerLower.findIndex(h => h === 'prompt');
    if (promptIdx < 0) { i++; continue; }

    const modeIdx = headerLower.findIndex(h =>
      h === 'mode' || h === 'auto/manual' || h.includes('auto') || h.includes('manual'),
    );
    const numIdx = headerLower.findIndex(h => h === '#');
    const depsIdx = headerLower.findIndex(h => h.includes('depends'));

    i++; // skip header
    // skip separator row (|---|---|)
    if (i < lines.length && lines[i].includes('---')) i++;

    const rows: PromptTableRow[] = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      const cells = lines[i].split('|').map(c => c.trim()).filter(Boolean);
      const depsRaw = depsIdx >= 0 ? (cells[depsIdx] ?? '') : '';
      rows.push({
        number: numIdx >= 0 ? (cells[numIdx] ?? '') : '',
        name: cells[promptIdx] ?? '',
        mode: modeIdx >= 0 ? (cells[modeIdx] ?? '') : '',
        dependsOn: depsRaw === '--' || depsRaw === ''
          ? []
          : depsRaw.split(/[,\s]+/).map(d => d.trim()).filter(d => d && d !== '--'),
        line: i + 1,
      });
      i++;
    }

    if (rows.length > 0) return rows;
    // else keep scanning
  }
  return null;
}

// --- Structural checks ---

const REQUIRED_HEADER_FIELDS = ['Complexity', 'Duration', 'Nearest', 'Branch', 'Created'];

function checkRequiredHeaders(headers: HeaderField[], file: string, obs: PlanAuditObservation[]): void {
  const names = new Set(headers.map(h => h.name));
  for (const field of REQUIRED_HEADER_FIELDS) {
    if (!names.has(field)) {
      emit(obs, 'PLAN_HEADER_MISSING', file, 1, { field });
    }
  }
}

function checkHeaderFormats(headers: HeaderField[], file: string, obs: PlanAuditObservation[]): void {
  for (const h of headers) {
    if (h.name === 'Complexity' && !/^D\d+\s+S\d+\s+Z\d+\s*=\s*\d+(\.\d+)?$/.test(h.value)) {
      emit(obs, 'PLAN_HEADER_INVALID', file, h.line, { field: 'Complexity', value: h.value });
    }
    if (h.name === 'Duration' && !/^F\d+\s+C\d+\s*=\s*\d+(\.\d+)?h\s*\(\d+(\.\d+)?-\d+(\.\d+)?h\)$/.test(h.value)) {
      emit(obs, 'PLAN_HEADER_INVALID', file, h.line, { field: 'Duration', value: h.value });
    }
  }
}

function checkPreFlightMark(headers: HeaderField[], file: string, obs: PlanAuditObservation[]): void {
  const pf = headers.find(h => h.name === 'Pre-flight');
  if (pf) {
    const m = pf.value.match(/^(CERTIFIED|CONDITIONAL|BLOCKED)\s+(\S+)/);
    emit(obs, 'PRE_FLIGHT_CERTIFIED', file, pf.line, {
      certificationTier: m?.[1] ?? pf.value,
      certificationDate: m?.[2] ?? '',
    });
  } else {
    emit(obs, 'PRE_FLIGHT_MARK_MISSING', file, 1, {});
  }
}

function checkVerificationBlock(tree: MdNode, file: string, obs: PlanAuditObservation[]): void {
  const headings = findAll(tree, 'heading');
  const has = headings.some(h => {
    const t = nodeText(h).toLowerCase();
    return t.includes('verification checklist') || t.includes('pre-execution verification');
  });
  if (!has) {
    emit(obs, 'VERIFICATION_BLOCK_MISSING', file, 1, {});
  }
}

function checkCleanupReference(content: string, file: string, obs: PlanAuditObservation[]): void {
  if (!/-cleanup\.md\b/.test(content) && !/\bcleanup\s+file\b/i.test(content)) {
    emit(obs, 'CLEANUP_FILE_MISSING', file, 1, {});
  }
}

function checkPromptModes(table: PromptTableRow[], file: string, obs: PlanAuditObservation[]): void {
  for (const row of table) {
    const m = row.mode.toLowerCase();
    if (!m.includes('auto') && !m.includes('manual')) {
      emit(obs, 'PROMPT_MODE_UNSET', file, row.line, { promptName: row.name || row.number });
    }
  }
}

function checkDependencyCycles(table: PromptTableRow[], file: string, obs: PlanAuditObservation[]): void {
  const graph = new Map<string, string[]>();
  for (const row of table) {
    graph.set(row.number || row.name, row.dependsOn);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of graph.keys()) color.set(id, WHITE);

  function dfs(node: string, pathSoFar: string[]): string[] | null {
    color.set(node, GRAY);
    pathSoFar.push(node);
    for (const dep of graph.get(node) ?? []) {
      if (!graph.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        const start = pathSoFar.indexOf(dep);
        return [...pathSoFar.slice(start), dep];
      }
      if (color.get(dep) === WHITE) {
        const cycle = dfs(dep, pathSoFar);
        if (cycle) return cycle;
      }
    }
    pathSoFar.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const id of graph.keys()) {
    if (color.get(id) === WHITE) {
      const cycle = dfs(id, []);
      if (cycle) {
        emit(obs, 'PROMPT_DEPENDENCY_CYCLE', file, 1, { cyclePath: cycle });
        return;
      }
    }
  }
}

function checkStandingElements(tree: MdNode, file: string, obs: PlanAuditObservation[]): void {
  const children = tree.children ?? [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type !== 'heading') continue;
    const text = nodeText(child).toLowerCase();
    if (!text.includes('standing') || !text.includes('element')) continue;

    const headingDepth = child.depth ?? 2;

    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (next.type === 'heading' && (next.depth ?? 2) <= headingDepth) break;
      if (next.type === 'list') {
        const items = (next.children ?? []).filter(c => c.type === 'listItem');
        for (const item of items) {
          const itemText = nodeText(item);
          const line = nodeLine(item);
          const m = itemText.match(/^([A-Z][A-Z\s_]+?):\s*(.*)/);
          if (m) {
            const name = m[1].trim();
            const val = m[2].trim();
            if (!/\b(yes|no|n\/a|not needed|not applicable)\b/i.test(val)) {
              emit(obs, 'STANDING_ELEMENT_MISSING', file, line, { elementName: name });
            }
          }
        }
        break;
      }
    }
    break; // only process first standing elements section
  }
}

function checkPromptFilesExist(
  table: PromptTableRow[],
  promptFiles: string[],
  file: string,
  obs: PlanAuditObservation[],
): void {
  const basenames = promptFiles.map(p => path.basename(p));
  for (const row of table) {
    if (!row.number) continue; // skip rows without a prompt number -- cannot match to files
    const padded = row.number.padStart(2, '0');
    const num = row.number.replace(/^0+/, '') || '0';
    const found = basenames.some(bn => bn.includes(`-${padded}-`) || bn.includes(`-${num}-`));
    if (!found) {
      emit(obs, 'PROMPT_FILE_MISSING', file, row.line, { promptFile: `prompt ${padded}: ${row.name}` });
    }
  }
}

// --- Prompt file checks ---

function checkPromptVerification(promptPath: string, obs: PlanAuditObservation[]): void {
  const content = fs.readFileSync(promptPath, 'utf-8');
  const relPath = path.relative(process.cwd(), promptPath);
  const lines = content.split('\n');
  let foundVerifyHeading = false;
  let headingDepth = 0;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFenceLine = /^```/.test(line);

    if (isFenceLine) {
      if (foundVerifyHeading && !inFence) {
        return; // code block opens after verification heading -- good
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) {
      const depth = hm[1].length;
      const text = hm[2].toLowerCase();
      if (!foundVerifyHeading && (text.includes('verification') || text.includes('verify'))) {
        foundVerifyHeading = true;
        headingDepth = depth;
        continue;
      }
      if (foundVerifyHeading && depth <= headingDepth) {
        emit(obs, 'PROMPT_VERIFICATION_MISSING', relPath, i + 1, { promptFile: relPath });
        return;
      }
    }
  }

  if (!foundVerifyHeading) {
    emit(obs, 'PROMPT_VERIFICATION_MISSING', relPath, 1, { promptFile: relPath });
  } else {
    // Heading found but no code block followed before EOF
    emit(obs, 'PROMPT_VERIFICATION_MISSING', relPath, 1, { promptFile: relPath });
  }
}

function checkReconciliationTemplate(promptPath: string, obs: PlanAuditObservation[]): void {
  const content = fs.readFileSync(promptPath, 'utf-8');
  const relPath = path.relative(process.cwd(), promptPath);
  if (!/reconciliation/i.test(content)) {
    emit(obs, 'RECONCILIATION_TEMPLATE_MISSING', relPath, 1, { promptFile: relPath });
  }
}

// --- Convention observations (line-by-line text scan) ---

const NAMING_PATTERNS = [/\bcamelCase\b/i, /\bsnake_case\b/i, /\bPascalCase\b/i, /\bkebab-case\b/i];
const AGGREGATION_PATTERNS = [
  /\bmerge\s+(data|results|responses)\b/i,
  /\bcombine\s+(data|results|responses|queries)\b/i,
  /\bparallel\s+fetch/i,
  /\bdual\s+path/i,
  /\bfan[- ]?out\b/i,
  /\bclient[- ]?side\s+(aggregat|merg|combin)/i,
];
const DEFERRED_PATTERNS = [
  /\bdefer(?:red)?\s+to\s+cleanup\b/i,
  /\bhandle\s+in\s+cleanup\b/i,
  /\bcleanup\s+prompt\s+will\b/i,
];
const FILE_PATH_RE = /(?:`([^`]*(?:src\/|\.\/|~\/|\.\.\/)[^`]*)`|(?:^|\s)((?:src\/|\.\/|~\/|\.\.\/)[a-zA-Z0-9_\-.\/]+))/gm;
const SKILL_RE = /\/(?:build|refactor|audit|orchestrate|extract|flatten|migrate|replace|spawn|iterate|generate|sync|calibrate|visual|document)-[a-z]+(?:-[a-z]+)*/g;

function extractConventionObservations(filePath: string, obs: PlanAuditObservation[]): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const relPath = path.relative(process.cwd(), filePath);
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ln = i + 1;

    for (const p of NAMING_PATTERNS) {
      if (p.test(line)) {
        emit(obs, 'NAMING_CONVENTION_INSTRUCTION', relPath, ln, { instruction: line.trim().substring(0, 200) });
        break;
      }
    }
    for (const p of AGGREGATION_PATTERNS) {
      if (p.test(line)) {
        emit(obs, 'CLIENT_SIDE_AGGREGATION', relPath, ln, { matchedText: line.trim().substring(0, 200) });
        break;
      }
    }
    for (const p of DEFERRED_PATTERNS) {
      if (p.test(line)) {
        emit(obs, 'DEFERRED_CLEANUP_REFERENCE', relPath, ln, { deferredItem: line.trim().substring(0, 200) });
        break;
      }
    }

    FILE_PATH_RE.lastIndex = 0;
    let m;
    while ((m = FILE_PATH_RE.exec(line)) !== null) {
      emit(obs, 'FILE_PATH_REFERENCE', relPath, ln, { referencedPath: m[1] ?? m[2] });
    }

    SKILL_RE.lastIndex = 0;
    while ((m = SKILL_RE.exec(line)) !== null) {
      emit(obs, 'SKILL_REFERENCE', relPath, ln, { skillName: m[0] });
    }
  }
}

// --- Main analysis ---

export function analyzePlan(planPath: string, promptPaths: string[] = []): PlanAuditResult {
  if (!fs.existsSync(planPath)) fatal(`Plan file does not exist: ${planPath}`);

  const content = fs.readFileSync(planPath, 'utf-8');
  const tree = fromMarkdown(content) as unknown as MdNode;
  const relPath = path.relative(process.cwd(), planPath);
  const obs: PlanAuditObservation[] = [];

  // Blockquote header checks
  const headers = parseBlockquoteHeader(content);
  checkRequiredHeaders(headers, relPath, obs);
  checkHeaderFormats(headers, relPath, obs);
  checkPreFlightMark(headers, relPath, obs);

  // Section checks
  checkVerificationBlock(tree, relPath, obs);
  checkCleanupReference(content, relPath, obs);
  checkStandingElements(tree, relPath, obs);

  // Prompt table checks
  const table = parsePromptTable(content);
  if (table) {
    checkPromptModes(table, relPath, obs);
    checkDependencyCycles(table, relPath, obs);
    if (promptPaths.length > 0) {
      checkPromptFilesExist(table, promptPaths, relPath, obs);
    }
  }

  // Prompt file checks
  for (const pf of promptPaths) {
    checkPromptVerification(pf, obs);
    checkReconciliationTemplate(pf, obs);
  }

  // Convention observations from plan + prompts
  extractConventionObservations(planPath, obs);
  for (const pf of promptPaths) {
    extractConventionObservations(pf, obs);
  }

  return { filePath: relPath, observations: obs };
}

// --- CLI ---

function main(): void {
  const args = parseArgs(process.argv, { namedOptions: ['--prompts'] });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-plan-audit.ts <plan-file> [--prompts <glob>] [--pretty] [--kind <KIND>] [--count]\n\n' +
      'Options:\n' +
      '  --prompts <glob>  Glob pattern for prompt files (quote if using wildcards)\n' +
      '  --pretty          Pretty-print JSON output\n' +
      '  --kind <KIND>     Filter to a single observation kind\n' +
      '  --count           Output observation kind counts\n' +
      '  --help            Show this help\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) fatal('No plan file path provided. Use --help for usage.');

  const planPath = path.resolve(args.paths[0].replace(/^~/, process.env.HOME ?? '~'));

  let promptPaths: string[] = [];
  if (args.options.prompts) {
    const expanded = args.options.prompts.replace(/^~/, process.env.HOME ?? '~');
    promptPaths = fg.sync(expanded, { absolute: true });
  }
  for (let i = 1; i < args.paths.length; i++) {
    const p = path.resolve(args.paths[i].replace(/^~/, process.env.HOME ?? '~'));
    if (fs.existsSync(p)) promptPaths.push(p);
  }

  const result = analyzePlan(planPath, promptPaths);

  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-plan-audit.ts') || process.argv[1].endsWith('ast-plan-audit'));

if (isDirectRun) {
  main();
}
