/**
 * AST tool: Field Reference Finder
 *
 * Finds all files referencing a specific object field/property name across
 * the codebase. Unlike rg (which matches text), this uses the TypeScript
 * AST to find structural references:
 *
 * - Property access: `obj.fieldName`
 * - Destructuring: `const { fieldName } = obj`
 * - Object literal: `{ fieldName: value }`
 * - Type/interface property: `fieldName: string`
 * - Type indexing: `obj['fieldName']`
 *
 * Usage:
 *   npx tsx scripts/AST/ast-field-refs.ts <path...> --field <name> [--pretty] [--test-files]
 *
 * Examples:
 *   npx tsx scripts/AST/ast-field-refs.ts src/ --field active_time_ms --pretty
 *   npx tsx scripts/AST/ast-field-refs.ts src/shared/types/ --field workstream_value --pretty
 */

import { Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, fatal } from './cli';
import { getFilesInDirectory, type FileFilter } from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldReference {
  file: string;
  line: number;
  kind: 'property_access' | 'destructuring' | 'object_literal' | 'type_property' | 'element_access' | 'string_literal';
  context: string;
}

interface FieldRefsResult {
  field: string;
  totalRefs: number;
  fileCount: number;
  files: {
    file: string;
    refs: FieldReference[];
  }[];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function analyzeFile(filePath: string, fieldName: string): FieldReference[] {
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
  const relativePath = path.relative(PROJECT_ROOT, absolute);

  const sf = getSourceFile(absolute);
  if (!sf) return [];

  const refs: FieldReference[] = [];

  sf.forEachDescendant(node => {
    // Property access: obj.fieldName
    if (Node.isPropertyAccessExpression(node)) {
      if (node.getName() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'property_access',
          context: node.getText().slice(0, 80),
        });
      }
    }

    // Element access with string literal: obj['fieldName']
    if (Node.isElementAccessExpression(node)) {
      const arg = node.getArgumentExpression();
      if (arg && Node.isStringLiteral(arg) && arg.getLiteralValue() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'element_access',
          context: node.getText().slice(0, 80),
        });
      }
    }

    // Destructuring: const { fieldName } = ...
    if (Node.isBindingElement(node)) {
      const propName = node.getPropertyNameNode();
      const name = propName ? propName.getText() : node.getName();
      if (name === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'destructuring',
          context: node.getParent()?.getParent()?.getText().slice(0, 80) ?? node.getText(),
        });
      }
    }

    // Object literal property: { fieldName: value }
    if (Node.isPropertyAssignment(node)) {
      if (node.getName() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'object_literal',
          context: `${fieldName}: ${node.getInitializer()?.getText().slice(0, 60) ?? '...'}`,
        });
      }
    }

    // Shorthand property: { fieldName } (in object literal)
    if (Node.isShorthandPropertyAssignment(node)) {
      if (node.getName() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'object_literal',
          context: fieldName,
        });
      }
    }

    // Type/interface property signature: fieldName: Type
    if (Node.isPropertySignature(node)) {
      if (node.getName() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'type_property',
          context: node.getText().slice(0, 80),
        });
      }
    }

    // Property declaration in class: fieldName: Type
    if (Node.isPropertyDeclaration(node)) {
      if (node.getName() === fieldName) {
        refs.push({
          file: relativePath,
          line: node.getStartLineNumber(),
          kind: 'type_property',
          context: node.getText().slice(0, 80),
        });
      }
    }

    // String literal matching the field name (catches key: 'fieldName' patterns
    // commonly used in accessor definitions, column configs, and sort keys)
    if (Node.isStringLiteral(node) && node.getLiteralValue() === fieldName) {
      // Skip if already captured as element access (obj['field'])
      const parent = node.getParent();
      if (parent && Node.isElementAccessExpression(parent)) return;

      refs.push({
        file: relativePath,
        line: node.getStartLineNumber(),
        kind: 'string_literal',
        context: parent?.getText().slice(0, 80) ?? `'${fieldName}'`,
      });
    }
  });

  return refs;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv, {
    namedOptions: ['--field'],
  });

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-field-refs.ts <path...> --field <name> [--pretty] [--test-files]\n' +
        '\n' +
        'Find all structural references to a specific field/property name.\n' +
        '\n' +
        '  <path...>     One or more files or directories to scan\n' +
        '  --field       The field/property name to search for (required)\n' +
        '  --pretty      Format JSON output with indentation\n' +
        '  --test-files  Scan test files instead of production files\n',
    );
    process.exit(0);
  }

  const fieldName = args.options.field;
  if (!fieldName) {
    fatal('--field <name> is required. Use --help for usage.');
  }

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const testFiles = args.flags.has('test-files');
  const filter: FileFilter = testFiles ? 'test' : 'production';
  const allRefs: FieldReference[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);
    const filePaths = stat.isDirectory() ? getFilesInDirectory(absolute, filter) : [absolute];

    for (const fp of filePaths) {
      allRefs.push(...analyzeFile(fp, fieldName));
    }
  }

  // Group by file
  const byFile = new Map<string, FieldReference[]>();
  for (const ref of allRefs) {
    const existing = byFile.get(ref.file);
    if (existing) {
      existing.push(ref);
    } else {
      byFile.set(ref.file, [ref]);
    }
  }

  const result: FieldRefsResult = {
    field: fieldName,
    totalRefs: allRefs.length,
    fileCount: byFile.size,
    files: Array.from(byFile.entries()).map(([file, refs]) => ({ file, refs })),
  };

  process.stdout.write(JSON.stringify(result, null, args.pretty ? 2 : 0) + '\n');
}

// Run CLI when executed directly
const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-field-refs.ts') || process.argv[1].endsWith('ast-field-refs'));

if (isDirectRun) {
  main();
}
