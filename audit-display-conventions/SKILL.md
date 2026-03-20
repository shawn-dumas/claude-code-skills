---
name: audit-display-conventions
description: Audit files against the standardized display conventions for number formatting, percentage precision, duration display, and null/empty/zero handling. Uses ast-number-format, ast-null-display, and ast-interpret-display-format.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <file-or-directory-path>
---

Audit the files at `$ARGUMENTS` against the display conventions documented in
`docs/display-conventions.md`. This is a read-only diagnostic -- do not modify
any files. Produce a complete violation report.

**This skill is read-only. It does not modify any files.**

<!-- role: guidance -->

## Rules

TOOL OUTPUT: When AST tool output is available for a file being
audited, consume it as authoritative input. Do NOT re-evaluate
or second-guess tool-determined findings. The tool's observation
is the finding -- your job is to report it, not to question whether
it is valid.

GAP.md ENFORCEMENT: If you assign `architecture-smell` as the finding
kind, you MUST append to scripts/AST/GAPS.md with pattern class,
file example, and what tool would detect it. No exceptions.

<!-- role: guidance -->

## When to use / When NOT to use

**Use when:**

- Auditing display formatting patterns in UI code
- Checking for placeholder consistency across a feature area
- Verifying percentage precision matches its display context
- Pre-refactor assessment before applying display convention fixes

**Do NOT use when:**

- Auditing non-UI code (server handlers, scripts) -- use `/audit-module`
- Auditing test files -- use `/audit-react-test`
- Auditing code structure or DDAU boundaries -- use `/audit-react-feature`

<!-- role: reference -->

## Background

The source of truth for all display conventions is
`docs/display-conventions.md`. That document defines the rules for number
formatting, percentage precision, duration display, null/empty/zero
handling, and empty state messages. Do not duplicate the full rules here --
read the doc.

Summary of convention areas:

| Area                 | Rule                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| Number formatting    | Use `formatNumber`/`formatInt`/`formatCellValue`/`formatDuration`. Never raw `toFixed`.  |
| Percentage precision | 2 decimals in tables, 1 in progress bars, 0 in space-constrained contexts.               |
| Null/empty handling  | Use `NO_VALUE_PLACEHOLDER` from `@/shared/constants`. Never `'N/A'`, `'--'`, or `''`.    |
| Zero vs null         | Zero is a value, not missing. `formatInt(0)` = `"0"`, never `'-'`.                       |
| Null coalescing      | Use `??` for numeric columns. Use `\|\|` only for string columns with explicit comment.  |
| Empty state messages | Tables: `'There is no data'`. Never `'No data available'`.                               |

<!-- role: workflow -->

## Step 0: Run AST analysis tools

Run the two observation tools and the interpreter on the target path.

```bash
# Number formatting observations
npx tsx scripts/AST/ast-number-format.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-number-format.ts $ARGUMENTS --count

# Null/empty display observations
npx tsx scripts/AST/ast-null-display.ts $ARGUMENTS --pretty
npx tsx scripts/AST/ast-null-display.ts $ARGUMENTS --count

# Interpreter (classifies observations into assessments)
npx tsx scripts/AST/ast-interpret-display-format.ts $ARGUMENTS --pretty
```

New tools available for pre-audit analysis:
- ast-test-coverage: run to identify test coverage gaps

### Using observations and assessments

<!-- role: reference -->

Observations are structural facts emitted by the observer tools
(`ast-number-format`, `ast-null-display`). They describe what exists in
the code (e.g., "a `toFixed` call at line 42") without judgment.

Assessments are interpreter classifications emitted by
`ast-interpret-display-format`. Each assessment has a `confidence` level
(high/medium/low), a `rationale` explaining the classification, `basedOn`
references to the observations it drew from, and a `requiresManualReview`
flag. Assessments answer "is this a violation?" -- they are
interpretations, not absolute facts. Medium/low confidence assessments
need manual verification in Step 1.

<!-- role: reference -->

## Tool-to-convention mapping

| Assessment Kind               | Convention                               | Severity | Auto-fixable |
| ----------------------------- | ---------------------------------------- | -------- | ------------ |
| WRONG_PLACEHOLDER             | Use `'-'` not `'N/A'` etc.              | High     | Yes          |
| MISSING_PLACEHOLDER           | Every display cell needs a null fallback | High     | Yes          |
| FALSY_COALESCE_NUMERIC        | Use `??` not `\|\|` for numeric columns | Medium   | Manual       |
| HARDCODED_DASH                | Use `NO_VALUE_PLACEHOLDER` constant     | Low\*    | Yes          |
| RAW_FORMAT_BYPASS             | Use shared formatters                   | High     | Partial      |
| PERCENTAGE_PRECISION_MISMATCH | Context-appropriate precision           | Medium   | Manual       |
| ZERO_NULL_CONFLATION          | Distinguish zero from null              | High     | Manual       |
| INCONSISTENT_EMPTY_MESSAGE    | Use canonical empty state message       | Low      | Yes          |

\*`HARDCODED_DASH` is high-confidence from the interpreter but Low
severity in the audit because behavior is identical (`'-'` vs
`NO_VALUE_PLACEHOLDER` resolve to the same string). The fix improves
traceability only, not correctness.

**Overlap note:** A `toFixed(N)` call inside a `${...}%` template literal
emits both `RAW_FORMAT_BYPASS` and `PERCENTAGE_PRECISION_MISMATCH`. These
are distinct findings (one says "use shared formatter," the other says
"wrong precision for context"), but fixing `RAW_FORMAT_BYPASS` by switching
to `formatCellValue(_, PERCENTAGE)` will also resolve the precision
mismatch. When both appear for the same line, list the finding once under
Number Formatting (the higher-severity category) with a note that it also
resolves the precision mismatch. Do not duplicate it in the Percentage
Precision section.

<!-- role: guidance -->

## Report policy

- AST-confirmed findings get `[AST-confirmed]` tag and +1 concern-level bump
  (e.g., Consistency/Low becomes Consistency/Medium).
- `requiresManualReview: true` findings that are verified manually get
  `[Manual-verified]` tag.
- Findings from Step 2/3 grep that are not AST-detected get `[grep-only]`
  tag (lower confidence).
- High-confidence assessments with `requiresManualReview: false` qualify
  for `[AST-confirmed]`.

<!-- role: detect -->

## Step 1: Manual verification of AST findings

For each `requiresManualReview: true` assessment, read the source file
and verify:

- **WRONG_PLACEHOLDER** (N/A variant): Is this `'N/A'` semantic "not
  applicable" text (e.g., user has no name, concept does not apply)? If
  so, it is acceptable -- do not report as a violation. If it means "data
  is null/missing", report it.
- **FALSY_COALESCE_NUMERIC**: Is the column actually numeric? Check the
  column definition and data source.
- **ZERO_NULL_CONFLATION**: Can the value actually be `0` at runtime?
  Check the API response type.
- **MISSING_PLACEHOLDER**: Is there a parent component handling null?
  Check the container.
- **PERCENTAGE_PRECISION_MISMATCH** (medium confidence): Is the context
  detection correct? Verify whether the percentage appears in a table,
  progress bar, or space-constrained context.

<!-- role: detect -->

## Step 2: Check for patterns AST tools miss

These are supplemental grep checks that catch patterns the AST tools may
not cover. They produce lower-confidence findings.

- Grep for remaining `'N/A'` usage (single and double quotes):
  ```bash
  rg "'N/A'|\"N/A\"" $ARGUMENTS --no-heading
  ```
- Grep for `'No data available'` usage (single and double quotes):
  ```bash
  rg "'No data available'|\"No data available\"" $ARGUMENTS --no-heading
  ```
- Grep for empty string fallbacks:
  ```bash
  rg "\\? ''" $ARGUMENTS --no-heading
  ```

Note: Do NOT grep for hardcoded `'-'` in `src/shared/utils/number/` or
`src/shared/utils/time/` -- the formatter implementations are exempt per
`astConfig.displayFormat.formatterFilePaths`. Their internal `'-'`
literals define the canonical fallback behavior.

<!-- role: detect -->

## Step 3: Coverage gap detection

Check for files that format numbers without using shared formatters at
all. These are files that might need display convention fixes but would
not be caught by the AST tools because they never imported the formatters
in the first place.

```bash
# Files with toFixed/toLocaleString that do NOT import shared formatters
rg -l 'toFixed|toLocaleString' $ARGUMENTS | while read f; do
  rg -q 'formatNumber|formatInt|formatCellValue|formatDuration' "$f" || echo "MISSING_FORMATTER: $f"
done
```

<!-- role: emit -->

## Step 4: Produce the report

```markdown
# Display Conventions Audit: $ARGUMENTS

## Summary

- Files scanned: <count>
- Total findings: <count>
- Auto-fixable: <count>
- Manual review required: <count>

## Scorecard

| Convention Area      | Status             |
| -------------------- | ------------------ |
| Number formatting    | PASS / WARN / FAIL |
| Percentage precision | PASS / WARN / FAIL |
| Null/empty handling  | PASS / WARN / FAIL |
| Empty state messages | PASS / WARN / FAIL |
| Zero/null conflation | PASS / WARN / FAIL |

## Findings by Category

### Number Formatting (RAW_FORMAT_BYPASS)

| #   | File:Line | Kind | Severity | Evidence | Auto-fix |
| --- | --------- | ---- | -------- | -------- | -------- |

### Null/Empty Handling (WRONG_PLACEHOLDER, HARDCODED_DASH, MISSING_PLACEHOLDER, FALSY_COALESCE_NUMERIC)

| #   | File:Line | Kind | Severity | Evidence | Auto-fix |
| --- | --------- | ---- | -------- | -------- | -------- |

### Percentage Precision (PERCENTAGE_PRECISION_MISMATCH)

| #   | File:Line | Kind | Severity | Evidence | Auto-fix |
| --- | --------- | ---- | -------- | -------- | -------- |

### Zero/Null Conflation (ZERO_NULL_CONFLATION)

| #   | File:Line | Kind | Severity | Evidence | Auto-fix |
| --- | --------- | ---- | -------- | -------- | -------- |

### Empty State Messages (INCONSISTENT_EMPTY_MESSAGE)

| #   | File:Line | Kind | Severity | Evidence | Auto-fix |
| --- | --------- | ---- | -------- | -------- | -------- |

## Migration priority

1. <highest-severity auto-fixable findings>
2. <next batch>
3. <manual-review findings, ordered by severity>

## Recommendations

- Use `/refactor-display-conventions` to auto-fix findings marked "Yes" in Auto-fix column
- Manually review findings marked "Manual" before fixing
```

<!-- role: workflow -->

## Interpreter calibration gate

After completing the audit, if any misclassification affected a decision
in this skill's workflow (e.g., a false positive that was reported as a
finding, or a false negative that caused a violation to be missed),
create a ground truth feedback fixture using `/create-feedback-fixture`
for the `display-format` interpreter.

Do NOT create a fixture if you are unsure or the error did not affect
a decision.
