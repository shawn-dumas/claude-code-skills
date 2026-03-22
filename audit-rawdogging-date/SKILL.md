---
name: audit-rawdogging-date
description: Audit files for raw Date usage vs proper date handling (Temporal, formatDate, formatDuration). Uses ast-date-handling to classify every date operation by kind and layer (FE/BFF/shared). Produces a violation report with raw/proper ratio.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <file-or-directory-path>
---

Audit the files at `$ARGUMENTS` for raw Date usage. This is a read-only
diagnostic -- do not modify any files. Produce a complete report showing
every raw date operation with file, line, kind, and layer.

**This skill is read-only. It does not modify any files.**

<!-- role: guidance -->

## Rules

TOOL OUTPUT: `ast-date-handling` output is authoritative. Do NOT
re-evaluate or second-guess tool-determined findings. The tool's
observation is the finding -- your job is to report it.

GAP.md ENFORCEMENT: If you find a date pattern the tool does not detect,
append to `scripts/AST/GAPS.md`.

<!-- role: guidance -->

## When to use / When NOT to use

**Use when:**

- Someone asks "are we rawdogging dates?"
- Pre-migration assessment before a Temporal migration
- Auditing a feature area for date handling hygiene
- Verifying a Temporal migration actually removed raw Date usage

**Do NOT use when:**

- You already know the files and just want to fix them -- use
  `/refactor-rawdogging-date` directly
- Auditing display formatting (use `/audit-display-conventions`)
- Auditing code structure (use `/audit-react-feature` or `/audit-module`)

<!-- role: reference -->

## Background

The codebase is mid-migration from raw `Date` to `Temporal` (via
`temporal-polyfill`). The canonical utilities are:

| Layer | Proper approach | Location |
|---|---|---|
| Shared | `Temporal.PlainDate`, `Temporal.ZonedDateTime`, `toPlainDate()`, `toJSDate()` | `src/shared/utils/temporal/` |
| Shared | `formatDate()`, `formatDuration()`, `getDaysDiff()` | `src/shared/utils/date/` |
| Shared | `calculatePeriodEndsByDays()`, `calculatePeriodEndsByDates()` | `src/shared/utils/calculatePeriodEnds/` |
| Shared | `getStartEndTimes()` | `src/shared/utils/date/getStartEndTimes/` |
| BFF | `getFormattedDates()` | `src/server/productivity/getFormattedDates.ts` |
| BFF | FML date hacks (documented, intentional) | `src/server/fml-date-time-hacks.ts` |
| FE | `formatDate()`, `formatDuration()` in column renderers | Various `useXxxColumns.tsx` files |

**Known exceptions (do not flag):**

- `src/shared/utils/temporal/index.ts` -- the `toPlainDate()` bridge
  function intentionally uses `getFullYear()`/`getMonth()`/`getDate()` to
  convert flatpickr's local-timezone Date to Temporal. This is the ONE
  sanctioned Date-to-Temporal boundary.
- `src/server/fml-date-time-hacks.ts` -- documented date boundary hacks
  for ClickHouse compatibility. See `src/server/FML-DATE-TIME-HACKS.md`.
- `src/shared/ui/DateRangePicker/` -- flatpickr returns Date objects.
  Raw Date access inside the picker component is unavoidable.
- Fixture files (`src/fixtures/`) -- fixture builders use `new Date()` to
  generate seeded timestamps. This is test infrastructure, not production
  date handling.
- Test files -- `new Date()` in specs is standard test setup.

<!-- role: workflow -->

## Step 0: Run AST analysis

```bash
# Summary with raw/proper ratio by layer
npx tsx scripts/AST/ast-query.ts date-summary $ARGUMENTS --pretty

# Full observation list
npx tsx scripts/AST/ast-query.ts date-usage $ARGUMENTS --pretty

# Count by kind
npx tsx scripts/AST/ast-query.ts date-usage $ARGUMENTS --count

# Also scan test files for completeness
npx tsx scripts/AST/ast-query.ts date-usage $ARGUMENTS --test-files --count
```

<!-- role: workflow -->

## Step 1: Classify findings

Group the raw observations by severity:

**P0 -- Active bugs or data corruption risk:**

- `MANUAL_DATE_STRING_OP` in BFF layer: `.replace('T', ' ')` and
  `.split('T')` are fragile -- they break on timestamps with timezone
  suffixes. These are the FML date hacks that should be in
  `fml-date-time-hacks.ts` (documented) or migrated to Temporal.
- `RAW_DATE_CONSTRUCTOR` with string argument in BFF: `new Date(string)`
  parsing is implementation-defined. Different runtimes parse differently.

**P1 -- Migration debt (should fix):**

- `RAW_DATE_CONSTRUCTOR` in BFF/shared: `new Date()` for "now" should be
  `Temporal.Now.instant()` or `Temporal.Now.plainDateISO()`.
- `RAW_DATE_ACCESSOR` in BFF/shared: `.getFullYear()` etc. should use
  Temporal calendar methods.
- `RAW_DATE_FORMAT` in BFF/shared: `.toISOString()` should use
  Temporal's `.toString()` with calendar/timezone control.
- `RAW_DATE_STATIC` in production code: `Date.now()` is acceptable for
  timestamps/cache TTL but should be Temporal for date logic.

**P2 -- Acceptable (no action needed):**

- `TEMPORAL_USAGE` and `FORMAT_UTIL_USAGE` -- these are correct.
- `RAW_DATE_*` in known exceptions (see above).
- `RAW_DATE_STATIC` for cache TTL, performance timing, health checks.

<!-- role: workflow -->

## Step 2: Produce the report

Output this format:

```
=== DATE HANDLING AUDIT ===
Scope: $ARGUMENTS
Date: YYYY-MM-DD

Summary:
  Raw operations:    N
  Proper operations: N
  Ratio:             N/M raw (X%)

By layer:
  FE:     N raw / M proper (X%)
  BFF:    N raw / M proper (X%)
  Shared: N raw / M proper (X%)

By kind (raw only):
  RAW_DATE_CONSTRUCTOR:    N (P0: M, P1: K, P2: J)
  RAW_DATE_STATIC:         N (P0: M, P1: K, P2: J)
  RAW_DATE_ACCESSOR:       N (P0: M, P1: K, P2: J)
  RAW_DATE_FORMAT:         N (P0: M, P1: K, P2: J)
  MANUAL_DATE_STRING_OP:   N (P0: M, P1: K, P2: J)

Findings (P0 first, then P1):

### [P0/P1] file:line -- kind
  Pattern: new Date(someString)
  Context: <code snippet>
  Fix: Use Temporal.PlainDate.from() / Temporal.Instant.from()

Known exceptions skipped: N files
  - src/shared/utils/temporal/index.ts (toPlainDate bridge)
  - src/server/fml-date-time-hacks.ts (documented CH hacks)
  - src/shared/ui/DateRangePicker/ (flatpickr boundary)
  - src/fixtures/ (test infrastructure)

=== END DATE HANDLING AUDIT ===
```
