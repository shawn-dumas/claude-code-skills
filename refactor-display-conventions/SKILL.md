---
name: refactor-display-conventions
description: Fix display convention violations found by audit-display-conventions. Replaces wrong placeholders, adds NO_VALUE_PLACEHOLDER imports, swaps falsy to nullish coalescing, normalizes percentage precision, and fixes empty state messages.
context: fork
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, Task
argument-hint: <file-or-directory-path>
---

Fix display convention violations in `$ARGUMENTS`.

<!-- role: guidance -->

## Prerequisite

Run `/audit-display-conventions` first. This skill consumes the audit report.

If no audit report exists, run the audit as Step 0 before proceeding.

<!-- role: guidance -->

## Rules

TOOL OUTPUT: When AST tool output is available for a file being
refactored, consume it as authoritative input. Do NOT re-evaluate
or second-guess tool-determined findings. The tool's observation
is the finding -- your job is to fix it, not to question whether
it is valid.

GAP.md ENFORCEMENT: If you assign `architecture-smell` as the finding
kind, you MUST append to scripts/AST/GAPS.md with pattern class,
file example, and what tool would detect it. No exceptions.

<!-- role: workflow -->

## Step 0: Run AST analysis (if no prior audit)

If an audit report already exists, skip to Step 1. Otherwise, run the
same AST tool commands as the audit skill Step 0 on `$ARGUMENTS`:

```bash
npx tsx scripts/AST/ast-query.ts number-format $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts number-format $ARGUMENTS --count

npx tsx scripts/AST/ast-query.ts null-display $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts null-display $ARGUMENTS --count

npx tsx scripts/AST/ast-query.ts interpret-display $ARGUMENTS --pretty
```

New tools available for pre-refactor analysis:
- ast-test-coverage: run after refactoring to verify test coverage
  status hasn't degraded

<!-- role: workflow -->

## Step 1: Build the dependency picture

For each target file with findings:

1. Read the file's import chains to understand where data flows from.
2. Read type definitions for values being formatted or coalesced.
3. Check if the file is consumed by tests that assert on specific output
   strings.

This step prevents blind auto-fixes that break type contracts or test
expectations.

<!-- role: guidance -->

## Step 2: Classify and plan fixes

Group findings by fix strategy.

### Auto-fix strategies (apply without manual review)

| Assessment Kind               | Fix Strategy                                                                                                                                                                                                |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WRONG_PLACEHOLDER` (non-N/A) | Replace the wrong string (`'--'`, `'n/a'`, `'NA'`, `'None'`) with `NO_VALUE_PLACEHOLDER`. Add `import { NO_VALUE_PLACEHOLDER } from '@/shared/constants'` if not present.                                   |
| `HARDCODED_DASH`              | Replace literal `'-'` with `NO_VALUE_PLACEHOLDER`. Add import if not present.                                                                                                                               |
| `INCONSISTENT_EMPTY_MESSAGE`  | The `<Table>` component default placeholder is `'There is no data'`. If the file passes a custom `placeholder` prop with a wrong message, either replace the message or remove the prop to use the default. |

### Manual-fix strategies (require judgment)

| Assessment Kind                 | Fix Strategy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WRONG_PLACEHOLDER` (N/A)       | Review each `'N/A'` usage. If it means "data is null/missing", replace with `NO_VALUE_PLACEHOLDER`. If it means "not applicable" (semantic text, e.g., user has no name), leave it. Requires reading the data source to determine intent.                                                                                                                                                                                                                                                   |
| `MISSING_PLACEHOLDER`           | Add `?? NO_VALUE_PLACEHOLDER` to the expression. Requires checking: is the parent already handling null? Is this actually a display context?                                                                                                                                                                                                                                                                                                                                                |
| `ZERO_NULL_CONFLATION`          | Replace `!value` with `value == null` or `value === null \|\| value === undefined`. Replace `val ? ... : '-'` with `val != null ? ... : NO_VALUE_PLACEHOLDER`. Requires checking: can the value actually be 0 at runtime?                                                                                                                                                                                                                                                                   |
| `FALSY_COALESCE_NUMERIC`        | Replace `\|\|` with `??`. Requires type confirmation that the column is actually numeric -- auto-fix is unsafe without verifying the column definition and data source.                                                                                                                                                                                                                                                                                                                     |
| `PERCENTAGE_PRECISION_MISMATCH` | Adjust decimal places to match context. Table: `formatCellValue(_, PERCENTAGE)` (2 fixed). Progress bar: `formatNumber(_, 1)` (1). Space-constrained: `Math.round()` (0). Requires verifying context detection is correct.                                                                                                                                                                                                                                                                  |
| `RAW_FORMAT_BYPASS`             | Replace `value.toFixed(N)` with `formatNumber(value, N)`. Replace `value.toLocaleString('en-US')` with `formatInt(value)` or `formatNumber(value)`. Add import if not present. **For `toFixed` specifically:** only auto-fix when the value appears in JSX for human display. `toFixed` to `formatNumber` adds comma separators, which is a behavioral change that could break downstream parsing, CSV export, or data attributes. Move non-display `toFixed` uses to the manual-fix queue. |

<!-- role: detect -->

## Step 3: Process audit findings into refactor plan

For each finding from the audit report or AST interpreter output:

1. Classify as auto-fix or manual-fix per the tables above.
2. For auto-fix candidates, verify the dependency picture from Step 1
   does not contradict.
3. For manual-fix candidates, read surrounding context and determine if
   safe.
4. Produce an ordered list of edits grouped by file.

<!-- role: emit -->

## Step 4: Apply auto-fixes

For each auto-fixable finding:

1. Read the file.
2. Apply the fix using the Edit tool.
3. If the fix adds a new import, add it to the file's import block
   (maintain alphabetical order within the import group).
4. Verify the file still compiles: `pnpm tsc --noEmit -p tsconfig.check.json`
5. **If tsc fails after an auto-fix, revert the edit and move the finding
   to the manual-fix queue with a note explaining why auto-fix failed.**

### Import addition rules

- `NO_VALUE_PLACEHOLDER`: `import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';`
- `formatNumber`: `import { formatNumber } from '@/shared/utils';` (barrel import per cross-domain convention)
- `formatInt`: `import { formatInt } from '@/shared/utils';` (barrel import per cross-domain convention)
- `formatCellValue`: `import { formatCellValue } from '@/shared/utils';`
- `formatDuration`: `import { formatDuration } from '@/shared/utils';` (barrel import per cross-domain convention)
- If the file already imports from the same module, add the new name to the
  existing import statement.

<!-- role: emit -->

## Step 5: Apply manual fixes

For each manual-fix finding:

1. Read the file and surrounding context (container, type definitions).
2. Determine if the fix is safe (check types, check parent null handling).
3. If safe, apply the fix.
4. If unsafe or unclear, add a `// TODO(display-convention): <description>`
   comment and add to the cleanup file.

<!-- role: avoid -->

## What NOT to fix

- Do not modify the formatting utility implementations themselves
  (`formatNumber.ts`, `formatInt.ts`, `formatDuration.ts`,
  `formatCellValue.ts`). These are the source of truth.
- Do not change percentage precision in chart components that have their
  own documented precision requirements (PieChart always uses 2 decimals
  for tooltips -- this is correct per the convention).
- Do not touch files in `src/shared/utils/` unless fixing a raw format
  bypass in a non-utility file that happens to be in that directory.
- Do not change `||` to `??` on string-only columns that have intentional
  eslint-disable comments explaining the intent.
- Do not auto-fix assertion expected values in test files -- they should
  assert on the literal rendered string (`'-'`), not the constant. Only
  fix test files where the test constructs input data with wrong
  placeholders.
- Only replace `'-'` (HARDCODED_DASH) when it appears in a fallback
  position (right side of `||`, `??`, ternary false branch, or standalone
  return value). Do not replace dash literals used as delimiters, CSS
  values, or other non-placeholder purposes.

<!-- role: reference -->

## Common gotchas

- `formatCellValue` already handles null/undefined internally on
  `sd/productionize`. Do not add redundant `??` before
  `formatCellValue()`.
- `formatDuration` returns `'-'` for non-number input. Adding
  `?? '-'` after `formatDuration()` is redundant.
- When replacing `'N/A'` with `NO_VALUE_PLACEHOLDER` in a test file,
  also update the test assertion to expect `'-'` instead of `'N/A'`.

<!-- role: reference -->

## Type touchpoints

Canonical import paths for display convention symbols:

- `NO_VALUE_PLACEHOLDER`: `import { NO_VALUE_PLACEHOLDER } from '@/shared/constants';`
- `formatNumber`: `import { formatNumber } from '@/shared/utils';` (barrel import per cross-domain convention)
- `formatInt`: `import { formatInt } from '@/shared/utils';` (barrel import per cross-domain convention)
- `formatCellValue`: `import { formatCellValue } from '@/shared/utils';`
- `UnitsType`: `import { UnitsType } from '@/types';` (resolves to `src/ui/types/` via path alias)
- `formatDuration`: `import { formatDuration } from '@/shared/utils';` (barrel import per cross-domain convention)

<!-- role: workflow -->

## Step 6: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm test --run
pnpm build
npx eslint . --max-warnings 0
```

Run `ast-refactor-intent` for behavioral preservation check:

```bash
npx tsx scripts/AST/ast-refactor-intent.ts <before-files> <after-files> --pretty
```

Collect the before-file content (from git) and after-file content for each
modified file. Run the interpreter. If any intent signal pair shows
behavioral divergence, investigate and either justify or revert.

If the refactor-intent interpreter produces a misclassification that
affected a decision, create a feedback fixture via
`/create-feedback-fixture ast-interpret-refactor-intent <path>`.

Re-run the display format interpreter on the target to verify reduction:

```bash
npx tsx scripts/AST/ast-query.ts interpret-display $ARGUMENTS --pretty
```

The assessment count should be lower than before the refactor.

<!-- role: emit -->

## Step 7: Summary

Report:

```markdown
## Refactor Summary: $ARGUMENTS

### Before

- Total findings: <count>
- Auto-fixable: <count>
- Manual: <count>

### After

- Fixed: <count>
- Deferred (TODO comments): <count>
- Not applicable (false positives): <count>

### Changes by file

| File | Fixes applied | Details |
| ---- | ------------- | ------- |
```

<!-- role: workflow -->

## Interpreter calibration gate

If any misclassification affected a decision in this skill's workflow
(e.g., a false positive that led to an unnecessary edit, or a false
negative that caused a violation to be missed), create a ground truth
feedback fixture using `/create-feedback-fixture`.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
