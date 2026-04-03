---
name: refactor-error-handler
description: Refactor catch blocks to report errors to New Relic. Uses ast-error-flow to identify console-only sinks, then adds NR reporting alongside existing console.error calls.
context: fork
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
argument-hint: <file-or-directory-path>
---

Refactor catch blocks in `$ARGUMENTS` to add New Relic error reporting.
Uses `ast-error-flow` to identify catch blocks that log to `console.error`
without reporting to NR, then adds the appropriate NR reporting call.

For any TS/TSX source query, use the ast-query dispatcher:
`npx tsx scripts/AST/ast-query.ts <query-type> <path>`
Do NOT run `npx tsx scripts/AST/ast-*.ts` directly. Do NOT use `rg`, `sg`,
or the Grep tool on TS/TSX source.

<!-- role: guidance -->

## Rules

- Do NOT remove existing `console.error` calls -- NR reporting is
  additive, not a replacement. Console logs are the local fallback.
- Do NOT modify catch blocks that already have NR reporting.
- Do NOT modify catch blocks in NR utility files
  (`src/shared/utils/newrelic/`) -- their console.error is the
  intentional fallback when NR itself fails.
- Do NOT modify catch blocks that intentionally swallow errors (empty
  catch with a comment explaining why).
- Use the appropriate NR API based on context:
  - Client-side: `reportErrorToNewRelic(err)` from
    `@/shared/utils/newrelic`
  - Server-side: `newrelic.noticeError(err)` from `newrelic`
- Preserve existing error handling behavior. This is additive only.

<!-- role: guidance -->

## When to use / When NOT to use

**Use when:**

- `/audit-nr-observability` shows `NR_MISSING_ERROR_HANDLER` or
  `NR_MISSING_ERROR_REPORT` findings
- `ast-error-flow` shows `console` sinks that should also report to NR
- Migrating error handling to include NR reporting after server APM setup

**Do NOT use when:**

- NR APM is not yet installed (server-side) -- use
  `/build-nr-server-integration S1 S2` first
- The catch block is in test code or fixture code
- The catch block intentionally swallows errors (comment-documented)

<!-- role: workflow -->

## Step 1: Run error-flow analysis

```bash
npx tsx scripts/AST/ast-query.ts error-flow $ARGUMENTS --pretty
```

Identify all `ERROR_SINK_TYPE` observations with `sink: 'console'`.
These are the catch blocks that need NR reporting added.

<!-- role: workflow -->

## Step 2: Classify files by layer

Determine whether each file is client-side or server-side:

- **Client-side** (`src/ui/`, `src/shared/`): Use
  `reportErrorToNewRelic(err)` from `@/shared/utils/newrelic`
- **Server-side** (`src/server/`, `src/pages/api/`): Use
  `newrelic.noticeError(err)` from `newrelic`

<!-- role: workflow -->

## Step 3: Read each target file

Read each file that has console-only catch blocks. Understand the
existing error handling pattern before modifying.

<!-- role: workflow -->

## Step 4: Add NR reporting

For each console-only catch block:

### Client-side pattern

```typescript
import { reportErrorToNewRelic } from '@/shared/utils/newrelic';

try {
  // ...
} catch (err) {
  console.error('Something failed:', err);
  reportErrorToNewRelic(err);  // ADD THIS LINE
}
```

### Server-side pattern

```typescript
import newrelic from 'newrelic';

try {
  // ...
} catch (err) {
  console.error('Something failed:', err);
  newrelic.noticeError(  // ADD THIS BLOCK
    err instanceof Error ? err : new Error(String(err)),
    { context: 'meaningful-context-here' }
  );
}
```

For server-side, always wrap non-Error values since `noticeError`
expects an `Error` object.

<!-- role: workflow -->

## Step 5: Verify

```bash
# Typecheck
pnpm tsc --noEmit -p tsconfig.check.json

# Re-run error-flow to confirm console sinks now also have NR
npx tsx scripts/AST/ast-query.ts error-flow $ARGUMENTS --pretty

# Verify NR calls detected
npx tsx scripts/AST/ast-query.ts nr-client $ARGUMENTS --pretty   # for client files
npx tsx scripts/AST/ast-query.ts nr-server $ARGUMENTS --pretty   # for server files

# Run tests
pnpm vitest run <modified-test-files>
```

After refactoring, `ast-error-flow` should show `newrelic` sinks
where there were previously `console`-only sinks. The total number
of catch blocks should not change -- only the sink classification.

<!-- role: avoid -->

## Anti-patterns

- Do NOT wrap the NR call in a try-catch. If NR fails, it fails silently.
  The `reportErrorToNewRelic` wrapper already handles NR unavailability.
- Do NOT add NR reporting to catch blocks that rethrow (`sink: 'rethrow'`).
  The error will be caught and reported at a higher level.
- Do NOT add NR reporting to catch blocks that use response sinks
  (`sink: 'response'`) unless they also log to console. Response-only
  sinks are BFF handler patterns that will be covered by `withErrorHandler`.
- Do NOT change the error type or error message. Preserve the exact
  `console.error` arguments.
