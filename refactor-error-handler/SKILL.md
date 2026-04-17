---
name: refactor-error-handler
description: Refactor catch blocks to report errors to NR observability. Uses ast-error-flow to identify console-only sinks, then adds the appropriate reporting call alongside existing console.error calls (client: reportErrorToNewRelic, server: recordError via OTel).
context: fork
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
argument-hint: <file-or-directory-path>
---

Refactor catch blocks in `$ARGUMENTS` to add NR error reporting.
Uses `ast-error-flow` to identify catch blocks that log to `console.error`
without reporting to NR, then adds the appropriate reporting call.

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
- Use the appropriate reporting API based on context:
  - Client-side: `reportErrorToNewRelic(err)` from
    `@/shared/utils/newrelic`
  - Server-side: `recordError(err, attributes?)` from
    `@/server/lib/otelTracer`
- Preserve existing error handling behavior. This is additive only.

<!-- role: guidance -->

## When to use / When NOT to use

**Use when:**

- `/audit-nr-observability` shows `NR_MISSING_ERROR_HANDLER` or
  `NR_MISSING_ERROR_REPORT` findings
- `ast-error-flow` shows `console` sinks that should also report to NR
- Migrating error handling to include NR reporting after server APM setup

**Do NOT use when:**

- OTel SDK is not yet bootstrapped (server-side) -- check that
  `src/instrumentation.ts` exists before adding `recordError` calls
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
  `recordError(err, attributes?)` from `@/server/lib/otelTracer`

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
import { recordError } from '@/server/lib/otelTracer';

try {
  // ...
} catch (err) {
  console.error('Something failed:', err);
  recordError(err, { context: 'meaningful-context-here' });  // ADD THIS LINE
}
```

`recordError` handles non-Error values internally (converts via
`toError`), so no manual wrapping is needed.

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
