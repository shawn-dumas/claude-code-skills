import path from 'path';
import fs from 'fs';
import { Project, QuoteKind, SyntaxKind, type SourceFile, type CallExpression, type StringLiteral } from 'ts-morph';
import { parseArgs, output, fatal } from './cli';
import { PROJECT_ROOT } from './project';
import { extractNumberFormatObservations } from './ast-number-format';
import { extractNullDisplayObservations } from './ast-null-display';
import { interpretDisplayFormat } from './ast-interpret-display-format';
import { astConfig } from './ast-config';

const NO_VALUE_CONST = 'NO_VALUE_PLACEHOLDER';
const NO_VALUE_IMPORT_FROM = '@/shared/constants';
const SHARED_UTILS_IMPORT_FROM = '@/shared/utils';
const FORMAT_INT_NAME = 'formatInt';
const FORMAT_NUMBER_NAME = 'formatNumber';
const CANONICAL_EMPTY_MESSAGE = astConfig.displayFormat.canonicalEmptyMessage;
const WRONG_EMPTY_MESSAGES = astConfig.displayFormat.wrongEmptyMessages;
const WRONG_PLACEHOLDERS = astConfig.displayFormat.wrongPlaceholders;

const SUPPORTED_KINDS = new Set<string>([
  'MISSING_PLACEHOLDER',
  'HARDCODED_DASH',
  'INCONSISTENT_EMPTY_MESSAGE',
  'RAW_FORMAT_BYPASS',
  'PERCENTAGE_PRECISION_MISMATCH',
  'WRONG_PLACEHOLDER',
]);

const KINDS_REQUIRING_NO_VALUE_IMPORT = new Set<string>(['MISSING_PLACEHOLDER', 'HARDCODED_DASH', 'WRONG_PLACEHOLDER']);

export interface FixResult {
  file: string;
  applied: { kind: string; line: number; symbol?: string }[];
  skipped: { kind: string; line: number; reason: string }[];
  text: string;
}

function ensureNamedImport(source: SourceFile, moduleSpecifier: string, name: string): boolean {
  const existing = source.getImportDeclarations().find(d => d.getModuleSpecifierValue() === moduleSpecifier);

  if (existing) {
    const already = existing.getNamedImports().some(i => i.getName() === name);
    if (already) return false;
    existing.addNamedImport(name);
    return true;
  }

  source.addImportDeclaration({
    moduleSpecifier,
    namedImports: [name],
  });
  return true;
}

function ensureNoValueImport(source: SourceFile): boolean {
  return ensureNamedImport(source, NO_VALUE_IMPORT_FROM, NO_VALUE_CONST);
}

function ensureSharedUtilsImport(
  source: SourceFile,
  name: typeof FORMAT_INT_NAME | typeof FORMAT_NUMBER_NAME,
): boolean {
  return ensureNamedImport(source, SHARED_UTILS_IMPORT_FROM, name);
}

function isAlreadyCoalesced(call: CallExpression): boolean {
  const parent = call.getParent();
  if (!parent) return false;
  if (parent.getKind() === SyntaxKind.BinaryExpression) {
    const op = parent.asKindOrThrow(SyntaxKind.BinaryExpression).getOperatorToken().getKind();
    return op === SyntaxKind.QuestionQuestionToken;
  }
  return false;
}

function findGetValueCallAtLine(source: SourceFile, line: number): CallExpression | undefined {
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).find(call => {
    if (call.getStartLineNumber() !== line) return false;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    return name === 'getValue' && !isAlreadyCoalesced(call);
  });
}

function applyMissingPlaceholder(source: SourceFile, line: number): { ok: true } | { ok: false; reason: string } {
  const call = findGetValueCallAtLine(source, line);
  if (!call) {
    return { ok: false, reason: 'no unfixed getValue() call at line' };
  }
  const original = call.getText();
  call.replaceWithText(`${original} ?? ${NO_VALUE_CONST}`);
  return { ok: true };
}

function findStringLiteralAtLine(
  source: SourceFile,
  line: number,
  predicate: (s: StringLiteral) => boolean,
): StringLiteral | undefined {
  return source
    .getDescendantsOfKind(SyntaxKind.StringLiteral)
    .find(s => s.getStartLineNumber() === line && predicate(s));
}

function applyHardcodedDash(source: SourceFile, line: number): { ok: true } | { ok: false; reason: string } {
  const lit = findStringLiteralAtLine(source, line, s => s.getLiteralValue() === '-');
  if (!lit) {
    return { ok: false, reason: "no '-' literal at line" };
  }
  lit.replaceWithText(NO_VALUE_CONST);
  return { ok: true };
}

function applyInconsistentEmptyMessage(source: SourceFile, line: number): { ok: true } | { ok: false; reason: string } {
  const lit = findStringLiteralAtLine(source, line, s => WRONG_EMPTY_MESSAGES.has(s.getLiteralValue()));
  if (lit) {
    lit.replaceWithText(`'${CANONICAL_EMPTY_MESSAGE}'`);
    return { ok: true };
  }

  const jsxText = source
    .getDescendantsOfKind(SyntaxKind.JsxText)
    .find(t => t.getStartLineNumber() === line && WRONG_EMPTY_MESSAGES.has(t.getLiteralText().trim()));
  if (jsxText) {
    const original = jsxText.getLiteralText();
    const wrong = [...WRONG_EMPTY_MESSAGES].find(m => original.includes(m))!;
    jsxText.replaceWithText(original.replace(wrong, CANONICAL_EMPTY_MESSAGE));
    return { ok: true };
  }

  return { ok: false, reason: 'no wrong-empty-message text at line' };
}

function findRawFormatCallAtLine(source: SourceFile, line: number): CallExpression | undefined {
  return source.getDescendantsOfKind(SyntaxKind.CallExpression).find(call => {
    if (call.getStartLineNumber() !== line) return false;
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
    const name = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    return name === 'toFixed' || name === 'toLocaleString';
  });
}

function applyWrongPlaceholder(source: SourceFile, line: number): { ok: true } | { ok: false; reason: string } {
  const lit = findStringLiteralAtLine(source, line, s => {
    const val = s.getLiteralValue();
    return WRONG_PLACEHOLDERS.has(val) && val !== 'N/A';
  });
  if (!lit) {
    return { ok: false, reason: 'no non-N/A wrong placeholder literal at line' };
  }
  lit.replaceWithText(NO_VALUE_CONST);
  return { ok: true };
}

function applyRawFormatBypass(
  source: SourceFile,
  line: number,
  importsNeeded: Set<typeof FORMAT_INT_NAME | typeof FORMAT_NUMBER_NAME>,
): { ok: true } | { ok: false; reason: string } {
  const call = findRawFormatCallAtLine(source, line);
  if (!call) {
    return { ok: false, reason: 'no toFixed/toLocaleString call at line' };
  }

  const pae = call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const receiver = pae.getExpression().getText();
  const methodName = pae.getName();
  const args = call.getArguments();

  if (methodName === 'toLocaleString') {
    if (args.length !== 0) {
      return { ok: false, reason: 'toLocaleString with args is unsupported' };
    }
    call.replaceWithText(`${FORMAT_INT_NAME}(${receiver})`);
    importsNeeded.add(FORMAT_INT_NAME);
    return { ok: true };
  }

  if (args.length !== 1) {
    return { ok: false, reason: 'toFixed expects exactly one argument' };
  }
  const decimalsText = args[0].getText();
  call.replaceWithText(`${FORMAT_NUMBER_NAME}(${receiver}, ${decimalsText})`);
  importsNeeded.add(FORMAT_NUMBER_NAME);
  return { ok: true };
}

function applyPercentagePrecisionMismatch(
  source: SourceFile,
  line: number,
  expectedDecimals: number,
  importsNeeded: Set<typeof FORMAT_INT_NAME | typeof FORMAT_NUMBER_NAME>,
): { ok: true } | { ok: false; reason: string } {
  const call = findRawFormatCallAtLine(source, line);
  if (!call) {
    return { ok: false, reason: 'no toFixed/toLocaleString call at line' };
  }

  const pae = call.getExpression().asKindOrThrow(SyntaxKind.PropertyAccessExpression);
  const receiver = pae.getExpression().getText();

  call.replaceWithText(`${FORMAT_NUMBER_NAME}(${receiver}, ${expectedDecimals})`);
  importsNeeded.add(FORMAT_NUMBER_NAME);
  return { ok: true };
}

function createFixerProject(): Project {
  return new Project({
    tsConfigFilePath: path.join(PROJECT_ROOT, 'tsconfig.json'),
    skipAddingFilesFromTsConfig: true,
    manipulationSettings: { quoteKind: QuoteKind.Single },
  });
}

export function fixSourceFile(filePath: string): FixResult {
  const project = createFixerProject();
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const source = project.addSourceFileAtPath(absolute);

  const numberObs = extractNumberFormatObservations(source);
  const nullObs = extractNullDisplayObservations(source);
  const { assessments } = interpretDisplayFormat(numberObs, nullObs);

  const applied: FixResult['applied'] = [];
  const skipped: FixResult['skipped'] = [];
  const formatImportsNeeded = new Set<typeof FORMAT_INT_NAME | typeof FORMAT_NUMBER_NAME>();

  // When PERCENTAGE_PRECISION_MISMATCH and RAW_FORMAT_BYPASS target the same
  // line, the precision handler is strictly better (it also fixes the raw call
  // AND corrects the decimal count). Drop the redundant RAW_FORMAT_BYPASS so
  // the precision handler can operate on the intact toFixed call.
  const precisionLines = new Set(
    assessments
      .filter(
        a =>
          a.kind === 'PERCENTAGE_PRECISION_MISMATCH' &&
          a.confidence === 'high' &&
          !a.requiresManualReview &&
          a.subject.line !== undefined,
      )
      .map(a => a.subject.line!),
  );
  const deduped = assessments.filter(
    a => !(a.kind === 'RAW_FORMAT_BYPASS' && a.subject.line !== undefined && precisionLines.has(a.subject.line)),
  );

  for (const a of deduped) {
    if (a.subject.line === undefined) {
      continue;
    }
    const line = a.subject.line;
    if (a.requiresManualReview) {
      skipped.push({ kind: a.kind, line, reason: 'requiresManualReview' });
      continue;
    }
    if (a.confidence !== 'high') {
      skipped.push({ kind: a.kind, line, reason: `confidence=${a.confidence}` });
      continue;
    }
    if (!SUPPORTED_KINDS.has(a.kind)) {
      skipped.push({ kind: a.kind, line, reason: 'kind not yet supported' });
      continue;
    }

    let result: { ok: true } | { ok: false; reason: string };
    if (a.kind === 'MISSING_PLACEHOLDER') {
      result = applyMissingPlaceholder(source, line);
    } else if (a.kind === 'HARDCODED_DASH') {
      result = applyHardcodedDash(source, line);
    } else if (a.kind === 'INCONSISTENT_EMPTY_MESSAGE') {
      result = applyInconsistentEmptyMessage(source, line);
    } else if (a.kind === 'RAW_FORMAT_BYPASS') {
      result = applyRawFormatBypass(source, line, formatImportsNeeded);
    } else if (a.kind === 'WRONG_PLACEHOLDER') {
      result = applyWrongPlaceholder(source, line);
    } else if (a.kind === 'PERCENTAGE_PRECISION_MISMATCH') {
      if (a.expectedDecimals === undefined) {
        result = { ok: false, reason: 'no expectedDecimals on assessment' };
      } else {
        result = applyPercentagePrecisionMismatch(source, line, a.expectedDecimals, formatImportsNeeded);
      }
    } else {
      result = { ok: false, reason: 'no handler' };
    }

    if (result.ok) {
      applied.push({ kind: a.kind, line, symbol: a.subject.symbol });
    } else {
      skipped.push({ kind: a.kind, line, reason: result.reason });
    }
  }

  const needsNoValueImport = applied.some(a => KINDS_REQUIRING_NO_VALUE_IMPORT.has(a.kind));
  if (needsNoValueImport) {
    ensureNoValueImport(source);
  }

  for (const name of formatImportsNeeded) {
    ensureSharedUtilsImport(source, name);
  }

  return {
    file: path.relative(PROJECT_ROOT, absolute),
    applied,
    skipped,
    text: source.getFullText(),
  };
}

export function main(): void {
  const args = parseArgs(process.argv, {
    extraBooleanFlags: ['--write', '--stdout'],
  });
  if (args.help || args.paths.length === 0) {
    console.error(
      'Usage: ast-fix-display-format <path> [--write] [--stdout] [--pretty]\n' +
        '  --write  modify files in place\n' +
        '  --stdout print modified source to stdout (default: JSON report only)',
    );
    process.exit(args.help ? 0 : 1);
  }

  const reports: FixResult[] = [];
  for (const p of args.paths) {
    try {
      reports.push(fixSourceFile(p));
    } catch (err) {
      fatal(`failed: ${p}: ${(err as Error).message}`);
    }
  }

  if (args.flags.has('write')) {
    for (const r of reports) {
      if (r.applied.length === 0) continue;
      const abs = path.isAbsolute(r.file) ? r.file : path.resolve(PROJECT_ROOT, r.file);
      fs.writeFileSync(abs, r.text, 'utf8');
    }
  }

  if (args.flags.has('stdout')) {
    for (const r of reports) process.stdout.write(r.text);
    return;
  }

  output(
    {
      files: reports.map(r => ({ file: r.file, applied: r.applied, skipped: r.skipped })),
    },
    args.pretty,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
