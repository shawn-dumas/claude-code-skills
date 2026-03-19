---
name: build-ast-tool
description: Build a new AST analysis tool for scripts/AST/. Use when a pattern class in GAPS.md has 3+ entries and justifies a purpose-built analyzer.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
argument-hint: <pattern-class name from GAPS.md>
---

<!-- role: guidance -->

# build-ast-tool

Build a new AST analysis tool for `scripts/AST/`. Use this skill when a
pattern class in `scripts/AST/GAPS.md` has 3+ entries across different
skills or prompts and justifies a purpose-built analyzer.

<!-- role: guidance -->

## When to use

- A pattern class in GAPS.md appears 3+ times from different contexts
- An existing skill or orchestration prompt repeatedly uses `sg` for the
  same structural query that would benefit from typed observations
- You need a new observation kind that interpreters can consume

<!-- role: avoid -->

## When NOT to use

- The pattern is narrow (one-off query for a specific refactor) -- use `sg`
- The pattern is non-structural (string literals, config values) -- use `rg`
- An existing AST tool already covers the pattern (check GAPS.md for
  `filled` entries and the tool inventory in `CLAUDE.md`)

<!-- role: reference -->

## Prerequisites

Read these files before starting:

1. `scripts/AST/GAPS.md` -- identify which gap(s) this tool fills
2. `scripts/AST/types.ts` -- all observation/assessment type definitions
3. `scripts/AST/cli.ts` -- shared CLI infrastructure (parseArgs, outputFiltered, fatal). `parseArgs` returns `flags: Set<string>` for boolean flags and `options: Record<string, string>` for named key-value pairs (e.g., `--kind`).
4. `scripts/AST/project.ts` -- shared project scanning (getProject, getSourceFile, findConsumerFiles)
5. `scripts/AST/shared.ts` -- shared utilities (getFilesInDirectory, truncateText, getContainingFunctionName, detectComponents). Note the `FileFilter` type (`'production' | 'test' | 'all'`) accepted by `getFilesInDirectory`.
6. `scripts/AST/ast-config.ts` -- repo conventions (hook lists, path patterns, thresholds)
7. `scripts/AST/ast-cache.ts` -- caching infrastructure (cached, getCacheStats). Use `args.flags.has('no-cache')` from `parseArgs` instead of the deprecated `hasNoCacheFlag`.
8. `scripts/AST/tool-registry.ts` -- tool registration (registerTool, getToolList)
9. `scripts/AST/git-source.ts` -- git-based file content retrieval for before/after comparisons
10. At least two existing tools for reference patterns:

- `scripts/AST/ast-complexity.ts` -- simple observation-only tool
- `scripts/AST/ast-imports.ts` -- tool with both observations and an interpreter

<!-- role: workflow -->

## Step 0: Validate the gap

1. Read `scripts/AST/GAPS.md`. Identify the gap entry (or entries) this
   tool will fill.
2. Confirm the pattern class has 3+ occurrences or is otherwise justified.
3. Check the existing tool inventory -- make sure no existing tool already
   covers this pattern. The tool inventory is in `CLAUDE.md` under
   "Tool inventory."
4. Define the observation kind(s) this tool will emit. Each observation
   kind needs:
   - A unique `kind` string (SCREAMING_SNAKE_CASE, e.g., `HOOK_CONSUMER_CALL`)
   - An `evidence` shape (structured data, not free text)
   - A `file` (relative path) and `line` (1-indexed)

<!-- role: emit -->

## Step 1: Define types

Add the new types to `scripts/AST/types.ts`:

1. **Analysis interface** -- the raw structured output of the tool
   (equivalent to `ComplexityAnalysis`, `ReactInventory`, etc.)
2. **Observation interface** -- extends the observation pattern with a
   specific `kind` and typed `evidence`. Follow the existing pattern:

   ```ts
   export interface MyNewObservation {
     kind: 'MY_OBSERVATION_KIND';
     file: string;
     line: number;
     evidence: {
       // structured fields, NOT free text
     };
   }
   ```

3. If the tool needs interpreter-level assessments, define an assessment
   interface too (with `confidence`, `rationale`, `basedOn`,
   `requiresManualReview`).

<!-- role: emit -->

## Step 2: Implement the tool

Create `scripts/AST/ast-<name>.ts`. Follow these structural requirements:

### Imports

```ts
import { type SourceFile, SyntaxKind, Node } from 'ts-morph';
import path from 'path';
import fs from 'fs';
import { getSourceFile, PROJECT_ROOT } from './project';
import { parseArgs, outputFiltered, fatal } from './cli';
import { getFilesInDirectory } from './shared';
import { astConfig } from './ast-config';
import { cached, getCacheStats } from './ast-cache';
import type {} from /* your types */ './types';
```

### Required exports

Every tool must export:

- **`analyze<Name>(filePath: string): <AnalysisType>`** -- single-file
  analysis. This is the programmatic API that tests and other tools call.
- **`analyze<Name>Directory(dirPath: string, options?: { noCache?: boolean; filter?: FileFilter }): <AnalysisType>[]`** --
  directory analysis with caching. Calls `analyze<Name>` for each file
  via `cached()`. The `filter` option controls which files are included
  (`'production'` by default, `'test'` for test files, `'all'` for both).
  Import `FileFilter` from `./shared`.
- **`extract<Name>Observations(analysis: <AnalysisType>): ObservationResult<ObservationType>`** --
  convert analysis output to the observation format.

### Structure

```
// Types (internal to the tool, not in types.ts)
// Helper functions (detection, classification)
// Public API (analyze, analyzeDirectory, extractObservations)
// CLI entry point (main + isDirectRun guard)
```

### CLI entry point

```ts
function main(): void {
  const args = parseArgs(process.argv);

  if (args.help) {
    process.stdout.write(
      'Usage: npx tsx scripts/AST/ast-<name>.ts <path...> [--pretty] [--kind <kind>] [--count] [--test-files] [--no-cache]\n' +
        '\n' +
        '<description of what the tool analyzes>\n' +
        '\n' +
        '  <path...>      One or more .ts/.tsx files or directories to analyze\n' +
        '  --pretty       Format JSON output with indentation\n' +
        '  --kind <kind>  Filter observations to a specific kind\n' +
        '  --count        Output observation kind counts instead of full data\n' +
        '  --test-files   Analyze test files instead of production files\n' +
        '  --no-cache     Bypass cache and recompute\n',
    );
    process.exit(0);
  }

  const noCache = args.flags.has('no-cache');
  const filter = args.flags.has('test-files') ? 'test' : 'production';

  if (args.paths.length === 0) {
    fatal('No file or directory path provided. Use --help for usage.');
  }

  const allResults: <AnalysisType>[] = [];

  for (const targetPath of args.paths) {
    const absolute = path.isAbsolute(targetPath) ? targetPath : path.resolve(PROJECT_ROOT, targetPath);

    if (!fs.existsSync(absolute)) {
      fatal(`Path does not exist: ${targetPath}`);
    }

    const stat = fs.statSync(absolute);

    if (stat.isDirectory()) {
      allResults.push(...analyze<Name>Directory(targetPath, { noCache, filter }));
    } else {
      allResults.push(cached('ast-<name>', absolute, () => analyze<Name>(targetPath), { noCache }));
    }
  }

  outputFiltered(allResults, args.pretty, { kind: args.options.kind, count: args.flags.has('count') });

  const stats = getCacheStats();
  if (stats.hits > 0 || stats.misses > 0) {
    process.stderr.write(`Cache: ${stats.hits} hits, ${stats.misses} misses\n`);
  }
}

const isDirectRun =
  process.argv[1] && (process.argv[1].endsWith('ast-<name>.ts') || process.argv[1].endsWith('ast-<name>'));

if (isDirectRun) {
  main();
}
```

### Principles

- **G1**: One observation domain per tool. Do not combine unrelated analyses.
- **G2**: `analyze<Name>` takes a file path, returns typed output. No ambient
  reads (except `astConfig` for repo conventions).
- **G4**: Keep branching low. Use lookup maps and early returns.
- **G6**: Analysis is pure (reads AST, returns data). I/O happens only in
  `main()`.
- **G7**: Export only `analyze<Name>`, `analyze<Name>Directory`,
  `extract<Name>Observations`. Keep helpers unexported.
- **G8**: Observation evidence fields are fully typed. No `any` or `unknown`.
- **G10**: Use `fatal()` for CLI errors. Observations report what exists;
  they do not silently skip files.

<!-- role: emit -->

## Step 3: Add config entries (if needed)

If the tool needs repo-specific configuration (lists of known patterns,
path exclusions, thresholds), add them to `scripts/AST/ast-config.ts`
under a new section. Follow the existing pattern:

```ts
// in ast-config.ts
export const astConfig = {
  // ... existing sections ...
  myNewDomain: {
    threshold: 5,
    excludedPaths: [/node_modules/, /__tests__/],
  },
} as const;
```

<!-- role: emit -->

## Step 4: Write tests

Create `scripts/AST/__tests__/ast-<name>.spec.ts`. Use the test config at
`scripts/AST/vitest.config.mts`.

### Test structure

1. **Create fixture files** in `scripts/AST/__tests__/fixtures/` that
   contain the patterns the tool should detect. Include both positive
   cases (patterns that should produce observations) and negative cases
   (patterns that should NOT produce observations).

2. **Test the analysis function** (`analyze<Name>`) against fixtures:

   - Verify observation count matches expected
   - Verify observation `kind`, `line`, and `evidence` fields
   - Verify no false positives from negative fixtures

3. **Test observation extraction** (`extract<Name>Observations`):
   - Verify the `ObservationResult` format
   - Verify `filePath` is relative

### Example test pattern

```ts
import { describe, it, expect } from 'vitest';
import path from 'path';
import { analyze<Name> } from '../ast-<name>';
import { PROJECT_ROOT } from '../project';

const fixture = (name: string) =>
  path.join(PROJECT_ROOT, 'scripts/AST/__tests__/fixtures', name);

describe('ast-<name>', () => {
  it('detects <pattern> in positive fixture', () => {
    const result = analyze<Name>(fixture('<name>-samples.ts'));
    expect(result.<field>.length).toBeGreaterThan(0);
    expect(result.<field>[0]).toMatchObject({
      // expected structure
    });
  });

  it('produces no observations for negative fixture', () => {
    const result = analyze<Name>(fixture('<name>-negative.ts'));
    expect(result.<field>.length).toBe(0);
  });
});
```

### Run tests

```bash
npx vitest run --config scripts/AST/vitest.config.mts scripts/AST/__tests__/ast-<name>.spec.ts
```

<!-- role: emit -->

## Step 5: Build an interpreter (if needed)

If the observations need classification or judgment (e.g., "is this
observation a violation?"), create `scripts/AST/ast-interpret-<name>.ts`.

Interpreters:

- Import observations from the tool
- Import repo conventions from `ast-config.ts`
- Produce assessments with `confidence`, `rationale`, `basedOn`,
  `requiresManualReview`
- Are separate files from the observation tool (separation of concerns)

Not every tool needs an interpreter. Observation-only tools (like
`ast-complexity`, `ast-side-effects`) are valid when skills apply their
own judgment policies.

<!-- role: workflow -->

## Step 6: Update the registry

1. **Update GAPS.md**: Change the status of the filled gap(s) from `open`
   to `filled (ast-<name>)`.

2. **Register in `tool-registry.ts`**: Add the new tool to the registry so
   it appears in tool listings and cache management:

   ```ts
   registerTool({
     name: 'ast-<name>',
     description: '<what it analyzes>',
     observationKinds: ['MY_OBSERVATION_KIND'],
     interpreter: 'ast-interpret-<name>', // or null for observation-only
   });
   ```

3. **Update `CLAUDE.md`**: Add the new tool to the "Tool inventory" table:

   ```
   | `ast-<name>` | `OBSERVATION_KIND_1`, `OBSERVATION_KIND_2` | `ast-interpret-<name>` (or observation-only) |
   ```

4. **Update skills README.md**: If the tool has an interpreter, add it to
   the tool list. If observation-only, note that.

<!-- role: workflow -->

## Step 7: Verify

```bash
# Type check
pnpm tsc --noEmit -p tsconfig.check.json

# Run the new tool on a sample directory
npx tsx scripts/AST/ast-<name>.ts src/<relevant-dir>/ --pretty

# Filter to a specific observation kind
npx tsx scripts/AST/ast-<name>.ts src/<relevant-dir>/ --kind MY_OBSERVATION_KIND --pretty

# Get observation counts only
npx tsx scripts/AST/ast-<name>.ts src/<relevant-dir>/ --count

# Analyze test files
npx tsx scripts/AST/ast-<name>.ts src/<relevant-dir>/ --test-files --pretty

# Run tests
npx vitest run --config scripts/AST/vitest.config.mts scripts/AST/__tests__/ast-<name>.spec.ts

# Verify no regressions in other AST tool tests
npx vitest run --config scripts/AST/vitest.config.mts
```

All four commands must pass before the tool is complete.

<!-- role: workflow -->

## Checklist

- [ ] Gap validated in GAPS.md (3+ entries or justified)
- [ ] Types added to `scripts/AST/types.ts`
- [ ] Tool file created at `scripts/AST/ast-<name>.ts`
- [ ] Exports: `analyze<Name>`, `analyze<Name>Directory`, `extract<Name>Observations`
- [ ] CLI entry point with `--help`, `--pretty`, `--no-cache`, `--kind`, `--count`, `--test-files`
- [ ] `astConfig` section added (if needed)
- [ ] Positive and negative test fixtures created
- [ ] Test file at `scripts/AST/__tests__/ast-<name>.spec.ts`
- [ ] All tests pass
- [ ] GAPS.md updated (status -> `filled`)
- [ ] `tool-registry.ts` registration added
- [ ] CLAUDE.md tool inventory updated
- [ ] Skills README.md updated (if interpreter added)
- [ ] `pnpm tsc --noEmit -p tsconfig.check.json` passes
- [ ] Tool produces correct output on real codebase files
