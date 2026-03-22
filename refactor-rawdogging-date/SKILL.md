---
name: refactor-rawdogging-date
description: Migrate raw Date usage to Temporal and codebase date utilities. Consumes ast-date-handling findings and applies file-by-file fixes, replacing new Date(), Date.now(), raw accessors, and manual string ops with Temporal equivalents.
context: fork
allowed-tools: Bash, Read, Glob, Grep, Edit, Write, Task
argument-hint: <file-or-directory-path>
---

Migrate raw Date usage in `$ARGUMENTS` to Temporal and codebase date
utilities.

<!-- role: guidance -->

## Prerequisite

Run `/audit-rawdogging-date` first. This skill consumes the audit report.

If no audit report exists, run the audit as Step 0 before proceeding.

<!-- role: guidance -->

## Rules

TOOL OUTPUT: `ast-date-handling` output is authoritative. Do NOT
re-evaluate or second-guess tool-determined findings. The tool's
observation is the finding -- your job is to fix it.

GAP.md ENFORCEMENT: If you find a date pattern the tool does not detect,
append to `scripts/AST/GAPS.md`.

**Do not touch known exceptions:**

- `src/shared/utils/temporal/index.ts` -- the toPlainDate bridge
- `src/server/fml-date-time-hacks.ts` -- documented CH date hacks
- `src/shared/ui/DateRangePicker/` -- flatpickr boundary
- Fixture files (`src/fixtures/`) -- test infrastructure
- Test files -- unless the test is asserting on raw Date behavior that
  changed due to the migration

**Tool hierarchy:** For any TS/TSX source query, run:
`npx tsx scripts/AST/ast-query.ts <query-type> <path>`.
Do NOT use `rg`, `sg`, or the Grep tool on TS/TSX source.
Run: `npx tsx scripts/AST/ast-query.ts --help` for available query types.

<!-- role: reference -->

## Migration patterns

Every raw Date pattern has a canonical Temporal replacement:

### RAW_DATE_CONSTRUCTOR

```typescript
// BEFORE: new Date() for "now"
const now = new Date();

// AFTER: Temporal for calendar date or instant
const now = Temporal.Now.plainDateISO();           // calendar date
const now = Temporal.Now.instant();                 // point in time
const now = Temporal.Now.zonedDateTimeISO('UTC');   // zoned
```

```typescript
// BEFORE: new Date(isoString) for parsing
const d = new Date('2025-01-15T00:00:00');

// AFTER: Temporal parsing (no ambiguity)
const d = Temporal.PlainDate.from('2025-01-15');
const d = Temporal.Instant.from('2025-01-15T00:00:00Z');
const d = Temporal.PlainDateTime.from('2025-01-15T00:00:00');
```

### RAW_DATE_STATIC

```typescript
// BEFORE: Date.now() for timestamps
const ts = Date.now();

// AFTER: keep Date.now() for millisecond timestamps (cache TTL, perf)
// OR use Temporal for date logic:
const ts = Temporal.Now.instant().epochMilliseconds;
```

### RAW_DATE_ACCESSOR

```typescript
// BEFORE: raw accessor chain
const year = date.getFullYear();
const month = date.getMonth() + 1;  // 0-indexed!

// AFTER: Temporal (1-indexed, no off-by-one)
const pd = toPlainDate(date);  // if crossing from flatpickr Date
const year = pd.year;
const month = pd.month;        // 1-indexed
```

### RAW_DATE_FORMAT

```typescript
// BEFORE: .toISOString()
const iso = date.toISOString();

// AFTER: Temporal string output
const iso = instant.toString();                    // 2025-01-15T00:00:00Z
const local = plainDateTime.toString();            // 2025-01-15T00:00:00
const dateOnly = plainDate.toString();             // 2025-01-15
```

### MANUAL_DATE_STRING_OP

```typescript
// BEFORE: .replace('T', ' ') for ClickHouse DateTime format
const ch = isoString.replace('T', ' ') + '.000';

// AFTER: use fml-date-time-hacks.ts (if CH-specific)
import { toClickHouseDateTime } from '@/server/fml-date-time-hacks';
const ch = toClickHouseDateTime(isoString);

// OR: Temporal formatting
const ch = plainDateTime.toString().replace('T', ' ') + '.000';
```

### Import additions

When migrating a file, add the Temporal import:

```typescript
import { Temporal } from '@/shared/utils/temporal';
// or if you need the bridge function:
import { Temporal, toPlainDate, toJSDate } from '@/shared/utils/temporal';
```

For shared date utilities:

```typescript
import { formatDate, formatDuration } from '@/shared/utils';
import { getDaysDiff } from '@/shared/utils/date/getDaysDiff';
import { getStartEndTimes } from '@/shared/utils/date/getStartEndTimes';
```

<!-- role: workflow -->

## Step 0: Run AST analysis (if no prior audit)

```bash
npx tsx scripts/AST/ast-query.ts date-summary $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts date-usage $ARGUMENTS --pretty
npx tsx scripts/AST/ast-query.ts date-usage $ARGUMENTS --count
```

<!-- role: workflow -->

## Step 1: Triage

From the audit output, filter to P0 and P1 findings only. Skip P2
(acceptable patterns like `Date.now()` for cache TTL, fixture builders,
known exceptions).

Order the work:

1. `MANUAL_DATE_STRING_OP` in BFF -- highest risk, fix first
2. `RAW_DATE_CONSTRUCTOR` with string arg in BFF -- parsing ambiguity
3. `RAW_DATE_ACCESSOR` chains in BFF/shared -- off-by-one risk
4. `RAW_DATE_FORMAT` in BFF/shared -- replace with Temporal toString
5. `RAW_DATE_CONSTRUCTOR` for "now" -- lowest risk, fix last

<!-- role: workflow -->

## Step 2: Migrate file by file

For each file with findings:

1. Read the file
2. Read its imports to understand what date utilities are already available
3. Apply the migration pattern from the reference section above
4. Add the `Temporal` import if not already present
5. Remove the `Date` usage (it's a global, no import to remove)
6. If the file has tests, check if they assert on raw Date output and
   update the assertions

**Behavioral preservation:** The migration must not change observable
behavior. `Temporal.PlainDate.from('2025-01-15').toString()` must produce
the same output as the raw Date code it replaces. Verify this for each
migration.

**FML hacks:** If a `MANUAL_DATE_STRING_OP` is a ClickHouse date boundary
hack, check whether it's already documented in `fml-date-time-hacks.ts`.
If yes, import from there. If no, add it there (with documentation) and
import. Do not leave undocumented `.replace('T', ' ')` calls in handler
logic files.

<!-- role: workflow -->

## Step 3: Verify

```bash
# Typecheck
pnpm tsc --noEmit -p tsconfig.check.json

# Tests
pnpm test --run

# Re-run the date handling audit to verify reduction
npx tsx scripts/AST/ast-query.ts date-summary $ARGUMENTS --pretty

# Build
pnpm build
```

The raw count should decrease. The proper count should increase or stay
the same. The ratio should improve.

<!-- role: workflow -->

## Step 4: Report

```
=== DATE HANDLING REFACTOR ===
Scope: $ARGUMENTS
Date: YYYY-MM-DD

Before: N/M raw (X%)
After:  N/M raw (X%)

Files modified: N
  - file1.ts: N raw -> M raw (migrated K patterns)
  - file2.ts: N raw -> 0 raw (fully migrated)

Patterns migrated:
  RAW_DATE_CONSTRUCTOR: N -> M
  RAW_DATE_STATIC:     N -> M
  RAW_DATE_ACCESSOR:   N -> M
  RAW_DATE_FORMAT:     N -> M
  MANUAL_DATE_STRING_OP: N -> M

Remaining raw (P2 / exceptions): N
  - Date.now() for cache TTL (N occurrences)
  - toPlainDate bridge (1 occurrence, sanctioned)
  - fml-date-time-hacks.ts (N occurrences, documented)

Verification:
  tsc: 0 errors
  Tests: N passed
  Build: clean
=== END DATE HANDLING REFACTOR ===
```
