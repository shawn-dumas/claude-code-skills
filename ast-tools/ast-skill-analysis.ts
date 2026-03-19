/**
 * ast-skill-analysis.ts
 *
 * MDAST-based tool that parses .claude/skills/ markdown files and produces
 * structured observations about their content. Enables structural search,
 * stale reference detection, cross-skill consistency checking, and content
 * inventory across all skill files.
 *
 * This tool emits observations only. Validation/staleness classification
 * belongs in a future ast-interpret-skill-quality interpreter.
 *
 * Usage:
 *   npx tsx scripts/AST/ast-skill-analysis.ts <dir-or-file...> [--pretty] [--kind <KIND>] [--count]
 */

import { fromMarkdown } from 'mdast-util-from-markdown';
import { toString as mdastToString } from 'mdast-util-to-string';
import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { parseArgs, outputFiltered, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { resolveConfig } from './ast-config';
import type {
  SkillAnalysisObservation,
  SkillAnalysisObservationKind,
  SkillAnalysisObservationEvidence,
  SkillAnalysisResult,
} from './types';

// --- Minimal MDAST node interface (same approach as ast-plan-audit) ---

interface MdNode {
  type: string;
  children?: MdNode[];
  value?: string;
  depth?: number;
  lang?: string;
  checked?: boolean | null;
  position?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

// --- MDAST helpers ---

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
  walk(tree, n => {
    if (n.type === type) result.push(n);
  });
  return result;
}

// --- Emit helper ---

function emit(
  obs: SkillAnalysisObservation[],
  kind: SkillAnalysisObservationKind,
  file: string,
  line: number,
  evidence: SkillAnalysisObservationEvidence,
): void {
  obs.push({ kind, file, line, evidence });
}

// --- Table helpers (raw text, same approach as ast-plan-audit) ---

function splitTableRow(line: string): string[] {
  const parts = line.split('|').map(c => c.trim());
  if (parts.length > 0 && parts[0] === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// --- Skill categorization ---

type SkillCategory = 'build' | 'refactor' | 'audit' | 'orchestrate' | 'other';

function categorizeSkill(skillName: string): SkillCategory {
  if (skillName.startsWith('build-')) return 'build';
  if (skillName.startsWith('refactor-')) return 'refactor';
  if (skillName.startsWith('audit-')) return 'audit';
  if (skillName.startsWith('orchestrate-')) return 'orchestrate';
  return 'other';
}

// --- Command classification ---

type CommandType = NonNullable<SkillAnalysisObservationEvidence['commandType']>;

function classifyCommand(command: string): CommandType {
  const trimmed = command.trim();

  // AST tools
  if (/\bast-/.test(trimmed) && /\bnpx\s+tsx\s+scripts\/AST\//.test(trimmed)) return 'ast-tool';

  // Typecheck
  if (/\btsc\b/.test(trimmed) || /\btype-?check/i.test(trimmed)) return 'typecheck';

  // Test
  if (/\b(vitest|jest|test|spec)\b/i.test(trimmed) || /\bpnpm\s+test\b/.test(trimmed)) return 'test';

  // Build
  if (/\bpnpm\s+build\b/.test(trimmed) || /\bnext\s+build\b/.test(trimmed)) return 'build';

  // Lint
  if (/\b(eslint|prettier|lint)\b/i.test(trimmed)) return 'lint';

  // Git
  if (/\bgit\s+/.test(trimmed)) return 'git';

  // npm/pnpm
  if (/\b(pnpm|npm|npx)\s+/.test(trimmed)) return 'npm';

  return 'other';
}

// --- File path detection ---

/**
 * Regex patterns for file path detection.
 * Matches paths with src/ prefix, @/ alias, ./ or ../ relative,
 * or paths ending in known extensions.
 */
const FILE_PATH_PATTERNS = [
  // src/... paths (most common in skills)
  /(?:^|\s|`|"|'|\()(\bsrc\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
  // @/ alias paths
  /(?:^|\s|`|"|'|\()(@\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
  // .claude/skills/ paths
  /(?:^|\s|`|"|'|\()(\.claude\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
  // scripts/ paths
  /(?:^|\s|`|"|'|\()(\bscripts\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
  // docs/ paths
  /(?:^|\s|`|"|'|\()(\bdocs\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
  // Relative paths with extensions
  /(?:^|\s|`|"|'|\()(\.\.?\/[\w./@-]+(?:\/[\w./@-]+)*\.\w+)/g,
  // integration/ paths
  /(?:^|\s|`|"|'|\()(\bintegration\/[\w./@-]+(?:\/[\w./@-]+)*)/g,
];

/**
 * Resolve a path reference to an absolute path for existence checking.
 * Returns null for paths that cannot be resolved (e.g., template variables).
 */
function resolvePathRef(refPath: string): string | null {
  // Skip template/variable paths
  if (/[$<{]/.test(refPath)) return null;
  // Skip glob patterns
  if (/[*?]/.test(refPath)) return null;
  // Skip ellipsis placeholders (e.g., @/components/...)
  if (/\.{3}/.test(refPath)) return null;
  // Skip truncated template paths ending with - (e.g., scripts/AST/ast-)
  if (/-$/.test(refPath)) return null;
  // Skip relative paths (./shared, ./handler-name.schema, ../utils)
  // These are relative imports shown in code examples, not resolvable from project root
  if (/^\.\.?\//.test(refPath)) return null;

  // Strip trailing punctuation that might have been captured
  const cleaned = refPath.replace(/[),;:]+$/, '');

  // @/ sub-aliases take priority over the catch-all (mirrors tsconfig.json paths)
  if (cleaned.startsWith('@/shared/')) {
    return path.resolve(PROJECT_ROOT, 'src/shared', cleaned.slice('@/shared/'.length));
  }
  if (cleaned.startsWith('@/server/')) {
    return path.resolve(PROJECT_ROOT, 'src/server', cleaned.slice('@/server/'.length));
  }
  if (cleaned.startsWith('@/fixtures/') || cleaned === '@/fixtures') {
    return path.resolve(PROJECT_ROOT, 'src/fixtures', cleaned.slice('@/fixtures'.length).replace(/^\//, ''));
  }
  if (cleaned.startsWith('@/pages/')) {
    return path.resolve(PROJECT_ROOT, 'src/pages', cleaned.slice('@/pages/'.length));
  }
  // @/root/* -> ./* (repo root)
  if (cleaned.startsWith('@/root/')) {
    return path.resolve(PROJECT_ROOT, cleaned.slice('@/root/'.length));
  }
  // Catch-all @/* -> src/ui/*
  if (cleaned.startsWith('@/')) {
    return path.resolve(PROJECT_ROOT, 'src/ui', cleaned.slice(2));
  }

  return path.resolve(PROJECT_ROOT, cleaned);
}

// --- Creation-intent detection ---

/**
 * Pattern that matches verbs indicating the path is being created, not referenced.
 * Checks the line containing the path and 2 lines before it.
 */
const CREATION_VERB_PATTERN = /\b(create|add|generate|write|mkdir|touch|new\s+file|scaffold|initialize|set\s+up)\b/i;

/** Placement/creation patterns that signal intent to create this path */
const CREATION_CHECKLIST_PATTERN =
  /\b(created?\s+in|created?\s+at|added?\s+to|generated?\s+in|goes\s+in|lives?\s+in|belongs?\s+in|placed?\s+in)\b/i;

/** Code comment patterns (e.g., "// src/server/fetchers/users.ts" as a file-to-create header) */
const CODE_COMMENT_FILE_HEADER = /^\/\/\s+(src\/|scripts\/|integration\/)/;

function detectCreationIntent(text: string, contextLines: readonly string[], lineIndex: number): boolean {
  // Check the current line
  if (CREATION_VERB_PATTERN.test(text)) return true;
  if (CREATION_CHECKLIST_PATTERN.test(text)) return true;
  if (CODE_COMMENT_FILE_HEADER.test(text.trim())) return true;

  // Check 2 lines before for creation verbs
  for (let i = Math.max(0, lineIndex - 2); i < lineIndex; i++) {
    if (CREATION_VERB_PATTERN.test(contextLines[i])) return true;
    if (CREATION_CHECKLIST_PATTERN.test(contextLines[i])) return true;
  }

  // Check for "new file" or "-- new" in table rows
  if (/\bnew\b/i.test(text) && text.trim().startsWith('|')) return true;

  return false;
}

function extractFilePaths(
  text: string,
  file: string,
  lineOffset: number,
  pathContext: SkillAnalysisObservationEvidence['pathContext'],
  obs: SkillAnalysisObservation[],
  contextLines?: readonly string[],
  lineIndex?: number,
): void {
  const seen = new Set<string>();

  for (const pattern of FILE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const refPath = match[1].replace(/[),;:]+$/, '');
      if (seen.has(refPath)) continue;
      seen.add(refPath);

      const resolved = resolvePathRef(refPath);
      let exists: boolean | undefined;
      if (resolved) {
        // Check both exact path and as directory (for paths without extension)
        exists = fs.existsSync(resolved) || fs.existsSync(resolved + '.ts') || fs.existsSync(resolved + '.tsx');
      }

      const creationIntent =
        contextLines && lineIndex !== undefined ? detectCreationIntent(text, contextLines, lineIndex) : undefined;

      emit(obs, 'SKILL_FILE_PATH_REF', file, lineOffset, {
        referencedPath: refPath,
        exists,
        pathContext,
        ...(creationIntent ? { creationIntent } : {}),
      });
    }
  }
}

// --- Shell command extraction from code blocks ---

function extractCommandsFromCodeBlock(
  content: string,
  lang: string | undefined,
  file: string,
  line: number,
  obs: SkillAnalysisObservation[],
): void {
  if (lang && !['bash', 'sh', 'shell', 'zsh', ''].includes(lang)) return;

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let cmdLine = lines[i].trim();
    if (!cmdLine || cmdLine.startsWith('#') || cmdLine.startsWith('//')) continue;
    // Skip pure output lines (lines that look like output, not commands)
    if (/^\s*[├└│]/.test(cmdLine)) continue;
    // Skip variable assignments that are not commands
    if (/^[A-Z_]+=\S+$/.test(cmdLine) && !/\s/.test(cmdLine)) continue;

    // Strip leading $ or > prompt markers
    cmdLine = cmdLine.replace(/^\$\s+/, '').replace(/^>\s+/, '');

    // Must look like a command (starts with a known command word or path)
    if (
      !/^(pnpm|npm|npx|node|tsx|bash|sh|git|docker|firebase|playwright|vitest|eslint|prettier|curl|wget|cd|ls|cat|grep|rg|sg|mkdir|cp|mv|rm)\b/.test(
        cmdLine,
      )
    ) {
      continue;
    }

    emit(obs, 'SKILL_COMMAND_REF', file, line + i, {
      content: cmdLine.length > 200 ? cmdLine.substring(0, 197) + '...' : cmdLine,
      commandType: classifyCommand(cmdLine),
    });
  }
}

// --- Cross-reference detection ---

/**
 * Match /skill-name patterns (skill references).
 * Requires at least one hyphen (all real skill names have hyphens).
 * Must not be preceded by / (avoids /api/mock/path false positives).
 */
const SKILL_REF_PATTERN = /(?:^|[\s`"'])\/([a-z][a-z]+-[a-z][\w-]*[\w])(?:[\s`"'.,;:)$]|$)/g;

/** Match docs/ file references (must not be preceded by / to avoid matching substrings like scripts/AST/docs/) */
const DOC_REF_PATTERN = /(?<![/\\])docs\/[\w./@-]+(?:\/[\w./@-]+)*\.md\b/g;

function extractCrossRefs(
  text: string,
  file: string,
  lineNumber: number,
  skillDirs: Set<string>,
  obs: SkillAnalysisObservation[],
): void {
  // Skill references
  SKILL_REF_PATTERN.lastIndex = 0;
  let match;
  while ((match = SKILL_REF_PATTERN.exec(text)) !== null) {
    const skillName = match[1];
    emit(obs, 'SKILL_CROSS_REF', file, lineNumber, {
      skillName,
      refExists: skillDirs.has(skillName),
    });
  }

  // Doc references
  DOC_REF_PATTERN.lastIndex = 0;
  while ((match = DOC_REF_PATTERN.exec(text)) !== null) {
    const docPath = match[0];
    const fullPath = path.resolve(PROJECT_ROOT, docPath);
    emit(obs, 'SKILL_DOC_REF', file, lineNumber, {
      referencedPath: docPath,
      refExists: fs.existsSync(fullPath),
    });
  }
}

// --- Fenced code block line set (for raw text extractors) ---

/**
 * Build a set of 0-indexed line numbers that fall inside fenced code blocks.
 * Used by extractTables, extractChecklists, and table-cell path extraction
 * to avoid false positives from content inside code block examples.
 */
function buildFencedLineSet(content: string): Set<number> {
  const lines = content.split('\n');
  const fenced = new Set<number>();
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trimStart())) {
      if (inBlock) {
        // closing fence -- this line is part of the block
        fenced.add(i);
      }
      inBlock = !inBlock;
      continue;
    }
    if (inBlock) fenced.add(i);
  }
  return fenced;
}

// --- Checklist detection (raw text, GFM task lists need extension for MDAST) ---

function extractChecklists(
  content: string,
  file: string,
  obs: SkillAnalysisObservation[],
  fencedLines: Set<number>,
): void {
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (fencedLines.has(i)) continue;
    const match = lines[i].match(/^(\s*[-*+]\s+)\[([ xX])\]\s+(.+)/);
    if (match) {
      const checked = match[2].toLowerCase() === 'x';
      const itemText = match[3].trim();
      emit(obs, 'SKILL_CHECKLIST_ITEM', file, i + 1, {
        checked,
        itemText: itemText.length > 200 ? itemText.substring(0, 197) + '...' : itemText,
      });
    }
  }
}

// --- Frontmatter detection ---

/**
 * Detect YAML frontmatter boundaries. Returns the 1-indexed line number
 * where content starts (after the closing ---), or 1 if no frontmatter.
 */
function detectFrontmatterEnd(content: string): number {
  const lines = content.split('\n');
  if (lines.length < 2 || lines[0].trim() !== '---') return 1;

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 2; // 1-indexed, line after closing ---
  }
  return 1;
}

// --- Table detection (raw text, GFM tables need extension for MDAST) ---

function extractTables(content: string, file: string, obs: SkillAnalysisObservation[], fencedLines: Set<number>): void {
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (fencedLines.has(i) || !lines[i].trim().startsWith('|')) {
      i++;
      continue;
    }

    const headerCells = splitTableRow(lines[i]);
    if (headerCells.length === 0) {
      i++;
      continue;
    }

    const headerLine = i + 1; // 1-indexed
    i++;

    // Skip separator row (must be pipe-delimited with dashes/colons)
    if (i < lines.length && /^\s*\|[\s-:|]+\|\s*$/.test(lines[i])) i++;

    // Count data rows
    let rowCount = 0;
    while (i < lines.length && lines[i].trim().startsWith('|')) {
      rowCount++;
      i++;
    }

    emit(obs, 'SKILL_TABLE', file, headerLine, {
      tableHeaders: headerCells,
      tableRowCount: rowCount,
    });
  }
}

// --- Convention scanning ---

function scanConventions(
  content: string,
  codeBlocks: { content: string; line: number }[],
  file: string,
  obs: SkillAnalysisObservation[],
): void {
  const config = resolveConfig();

  for (const rule of config.conventions.rules) {
    const scopeRegex = new RegExp(rule.scope, 'i');

    // Check if this skill is in scope for this convention
    if (!scopeRegex.test(content)) continue;

    // Check code blocks for superseded patterns
    for (const block of codeBlocks) {
      for (const pattern of rule.superseded) {
        const regex = new RegExp(pattern, 'i');
        if (regex.test(block.content)) {
          emit(obs, 'SKILL_SUPERSEDED_PATTERN', file, block.line, {
            conventionId: rule.id,
            conventionMessage: rule.message,
            matchedPattern: block.content.substring(0, 100),
          });
        }
      }
    }

    // Check if skill references any current pattern (in full content)
    const hasCurrentRef = rule.current.some(pattern => content.includes(pattern));

    if (!hasCurrentRef) {
      emit(obs, 'SKILL_MISSING_CONVENTION', file, 1, {
        conventionId: rule.id,
        conventionMessage: rule.message,
      });
    }
  }
}

// --- Main analysis ---

export function analyzeSkillFile(filePath: string, skillDirs: Set<string>): SkillAnalysisResult {
  if (!fs.existsSync(filePath)) fatal(`Skill file does not exist: ${filePath}`);

  const content = fs.readFileSync(filePath, 'utf-8');
  const tree = fromMarkdown(content) as unknown as MdNode;
  const relPath = path.relative(PROJECT_ROOT, path.resolve(filePath));

  // Derive skill name and category from directory
  const parentDir = path.basename(path.dirname(path.resolve(filePath)));
  const skillName = parentDir === 'skills' ? path.basename(filePath, '.md') : parentDir;
  const category = categorizeSkill(skillName);

  const obs: SkillAnalysisObservation[] = [];

  // Detect frontmatter boundary to skip it from heading extraction
  const frontmatterEnd = detectFrontmatterEnd(content);

  // --- Extract sections (headings) ---
  const headings = findAll(tree, 'heading');
  for (const h of headings) {
    const line = nodeLine(h);
    // Skip headings that fall inside YAML frontmatter (parser artifacts)
    if (line < frontmatterEnd) continue;

    const text = nodeText(h);
    const depth = h.depth ?? 1;

    emit(obs, 'SKILL_SECTION', relPath, line, { text, depth });

    // Check for step pattern: "Step N:" or "Step N " or "Step N."
    const stepMatch = text.match(/^Step\s+(\d+)/i);
    if (stepMatch) {
      emit(obs, 'SKILL_STEP', relPath, line, {
        text,
        depth,
        stepNumber: parseInt(stepMatch[1], 10),
      });
    }
  }

  // Split content into lines early (used by code block extraction and inline scanning)
  const contentLines = content.split('\n');

  // --- Extract code blocks ---
  const codeBlocks = findAll(tree, 'code');
  for (const cb of codeBlocks) {
    const cbContent = cb.value ?? '';
    const lang = cb.lang ?? undefined;
    const line = nodeLine(cb);

    emit(obs, 'SKILL_CODE_BLOCK', relPath, line, {
      lang: lang ?? '',
      content: cbContent.length > 300 ? cbContent.substring(0, 297) + '...' : cbContent,
    });

    // Extract commands from bash/shell code blocks
    extractCommandsFromCodeBlock(cbContent, lang, relPath, line, obs);

    // Extract file paths from code blocks (pass file lines for creation-intent context)
    // line is 1-indexed MDAST position; convert to 0-indexed for contentLines
    extractFilePaths(cbContent, relPath, line, 'code-block', obs, contentLines, line - 1);
  }

  // --- Extract inline code paths and cross-refs line by line ---
  // Track fenced code block boundaries to avoid false positives
  let inFencedBlock = false;
  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i];
    const lineNum = i + 1;

    // Toggle fenced code block state
    if (/^```/.test(line.trimStart())) {
      inFencedBlock = !inFencedBlock;
      continue;
    }

    // Skip lines inside fenced code blocks for inline code and cross-ref extraction
    if (inFencedBlock) continue;

    // Extract file paths from inline code (backtick-wrapped)
    const inlineCodePattern = /`([^`]+)`/g;
    let inlineMatch;
    while ((inlineMatch = inlineCodePattern.exec(line)) !== null) {
      const inlineContent = inlineMatch[1];
      // Only check for file path patterns, not arbitrary code
      if (/^(src\/|@\/|\.\/|\.\.\/|scripts\/|docs\/|\.claude\/|integration\/)/.test(inlineContent)) {
        const refPath = inlineContent.replace(/[),;:]+$/, '');
        const resolved = resolvePathRef(refPath);
        let exists: boolean | undefined;
        if (resolved) {
          exists = fs.existsSync(resolved) || fs.existsSync(resolved + '.ts') || fs.existsSync(resolved + '.tsx');
        }
        const creationIntent = detectCreationIntent(line, contentLines, i);
        emit(obs, 'SKILL_FILE_PATH_REF', relPath, lineNum, {
          referencedPath: refPath,
          exists,
          pathContext: 'inline-code',
          ...(creationIntent ? { creationIntent } : {}),
        });
      }
    }

    // Extract cross-references (only outside code blocks)
    extractCrossRefs(line, relPath, lineNum, skillDirs, obs);
  }

  // Build fenced line set for raw text extractors
  const fencedLines = buildFencedLineSet(content);

  // --- Extract tables (raw text approach, skipping fenced blocks) ---
  extractTables(content, relPath, obs, fencedLines);

  // --- Extract checklist items (raw text, no GFM extension, skipping fenced blocks) ---
  extractChecklists(content, relPath, obs, fencedLines);

  // --- Extract file paths from table cells (skipping fenced blocks) ---
  for (let i = 0; i < contentLines.length; i++) {
    if (fencedLines.has(i)) continue;
    const line = contentLines[i];
    if (!line.trim().startsWith('|')) continue;
    // Skip header separator rows
    if (/^\s*\|[\s-:|]+\|\s*$/.test(line)) continue;

    extractFilePaths(line, relPath, i + 1, 'table', obs, contentLines, i);
  }

  // --- Scan conventions ---
  const codeBlockData = codeBlocks.map(cb => ({
    content: cb.value ?? '',
    line: nodeLine(cb),
  }));
  scanConventions(content, codeBlockData, relPath, obs);

  return { filePath: relPath, skillName, category, observations: obs };
}

/**
 * Scan a directory for SKILL.md files and analyze each one.
 */
export function analyzeSkillDirectory(dirPath: string): SkillAnalysisResult[] {
  const absolute = path.isAbsolute(dirPath) ? dirPath : path.resolve(PROJECT_ROOT, dirPath);

  // Find all SKILL.md files
  const skillFiles = fg.sync('*/SKILL.md', { cwd: absolute, absolute: true });
  if (skillFiles.length === 0) {
    fatal(`No SKILL.md files found in ${dirPath}`);
  }

  // Build set of known skill directory names for cross-ref validation
  const skillDirs = new Set<string>();
  for (const f of skillFiles) {
    skillDirs.add(path.basename(path.dirname(f)));
  }

  const results: SkillAnalysisResult[] = [];
  for (const f of skillFiles) {
    results.push(analyzeSkillFile(f, skillDirs));
  }

  // Sort by skill name
  results.sort((a, b) => a.skillName.localeCompare(b.skillName));

  return results;
}

// --- CLI entry point ---

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-skill-analysis.ts <dir-or-file...> [--pretty] [--kind <KIND>] [--count]\n\n' +
        'Analyze .claude/skills/ markdown files for structural content.\n\n' +
        'Options:\n' +
        '  <dir-or-file...>  Directory containing */SKILL.md files, or individual .md files\n' +
        '  --pretty          Pretty-print JSON output\n' +
        '  --kind <KIND>     Filter to a single observation kind\n' +
        '  --count           Output observation kind counts\n' +
        '  --help            Show this help\n',
    );
    process.exit(0);
  }

  if (args.paths.length === 0) {
    fatal('No directory or file path provided. Use --help for usage.');
  }

  const allResults: SkillAnalysisResult[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyzeSkillDirectory(absolute));
    } else {
      // Single file mode: build skill dirs from the parent's parent directory
      const skillsDir = path.dirname(path.dirname(absolute));
      const siblingSkills = fg.sync('*/SKILL.md', { cwd: skillsDir, absolute: true });
      const skillDirs = new Set(siblingSkills.map(f => path.basename(path.dirname(f))));
      allResults.push(analyzeSkillFile(absolute, skillDirs));
    }
  }

  const result = allResults.length === 1 ? allResults[0] : allResults;
  outputFiltered(result, args.pretty, {
    kind: args.options.kind,
    count: args.flags.has('count'),
  });
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('ast-skill-analysis.ts') || process.argv[1].endsWith('ast-skill-analysis'));

if (isDirectRun) {
  main();
}
