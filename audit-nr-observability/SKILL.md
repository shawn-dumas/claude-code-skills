---
name: audit-nr-observability
description: Audit New Relic integration gaps across client (NREUM browser agent) and server (Node.js APM). Uses ast-nr-client, ast-nr-server, and ast-error-flow to produce a gap list showing where NR should be called but is not.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path-or-scope> (defaults to full project: src/ for client, src/server/ + src/pages/api/ for server)
---

Audit the New Relic integration at `$ARGUMENTS` (default: full project).
This is a read-only diagnostic -- do not modify any files. Produce a
complete gap list showing where NR integration is missing.

**This skill is read-only. It does not modify any files.**

<!-- role: guidance -->

## Rules

TOOL OUTPUT: `ast-nr-client`, `ast-nr-server`, and `ast-error-flow`
output is authoritative. Do NOT re-evaluate or second-guess
tool-determined findings. The tool's observation is the finding --
your job is to report it.

GAP.md ENFORCEMENT: If you find an NR pattern the tools do not detect,
append to `scripts/AST/GAPS.md`.

<!-- role: guidance -->

## When to use / When NOT to use

**Use when:**

- Assessing NR integration completeness before adding server APM
- Auditing a feature area for observability gaps
- Verifying NR integration after adding new error handling
- Pre-deployment observability readiness check

**Do NOT use when:**

- You already know the gaps and want to fix them -- use
  `/build-nr-client-integration` or `/build-nr-server-integration`
- Auditing error handling quality (use `/audit-module`)
- Auditing test coverage (use `/audit-react-test`)

<!-- role: reference -->

## Background

The codebase has two NR integration layers:

### Client (NREUM browser agent)

Substantially implemented. These are working, tested code:

| What | File | Status |
|---|---|---|
| `reportErrorToNewRelic()` | `src/shared/utils/newrelic/errorTracking.ts` | Working |
| `monitorApiCall()` | `src/shared/utils/newrelic/monitorApiCall.ts` | Working |
| React Query error reporting | `src/shared/utils/newrelic/reactQueryIntegration.ts` | Working |
| SPA route tracking | `src/ui/providers/NewRelicRouteTracker.tsx` | Working |
| ErrorBoundary -> NR | `src/shared/ui/ErrorBoundary/ErrorBoundary.tsx` | Working |
| fetchApi -> monitorApiCall | `src/shared/lib/fetchApi/fetchApi.ts` | Working |
| NR script injection | `src/pages/_document.tsx` | Working |
| NREUM type declarations | `src/shared/types/window.d.ts` | Working |

### Server (Node.js APM)

Zero APM integration. `@types/newrelic` is installed (TypeScript types
only) but the `newrelic` package itself is not. There is no `newrelic.js`
config file. Everything must be built from scratch.

<!-- role: reference -->

## Known client gaps

| # | Gap | Priority | Where to fix |
|---|-----|----------|-------------|
| C1 | No global `unhandledrejection`/`onerror` listeners | HIGH | `src/pages/_app.tsx` |
| C2 | No user ID as NR custom attribute on login | HIGH | Auth business logic |
| C3 | Auth pages not distinctly named in route tracker | MEDIUM | `NewRelicRouteTracker.tsx` |
| C4 | No Web Vitals reporting | MEDIUM | `_app.tsx` or new file |
| C5 | No custom performance marks | LOW | Various |

### Known server gaps

| # | Gap | Priority | Where to fix |
|---|-----|----------|-------------|
| S1 | `newrelic` package not installed | CRITICAL | `package.json` |
| S2 | No `newrelic.js` config | CRITICAL | repo root |
| S3 | `withErrorHandler` uses `console.error` only | HIGH | `src/server/middleware/withErrorHandler.ts` |
| S4 | `withAuth` doesn't set NR custom attributes | HIGH | `src/server/middleware/withAuth.ts` |
| S5 | Postgres queries uninstrumented | MEDIUM | Auto-instruments with agent |
| S6 | ClickHouse queries uninstrumented | MEDIUM | Custom segment wrapping |

<!-- role: workflow -->

## Step 0: Check package.json for newrelic package

```bash
# Check if newrelic is in production dependencies
grep '"newrelic"' package.json
```

If `newrelic` is not in `dependencies` (only in `devDependencies` as
`@types/newrelic`), flag this as S1: CRITICAL -- NR APM agent not installed.

<!-- role: workflow -->

## Step 1: Run client-side AST analysis

```bash
# Full NR client analysis
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --pretty

# Count by kind
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --count

# Missing patterns only
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --kind NR_MISSING_ERROR_HANDLER --pretty
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --kind NR_MISSING_USER_ID --pretty
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --kind NR_MISSING_UNHANDLED_REJECTION --pretty
npx tsx scripts/AST/ast-query.ts nr-client src/ui/ src/shared/ src/pages/ --kind NR_MISSING_WEB_VITALS --pretty
```

<!-- role: workflow -->

## Step 2: Run server-side AST analysis

```bash
# Full NR server analysis
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --pretty

# Count by kind
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --count

# Missing patterns only
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind NR_MISSING_ERROR_REPORT --pretty
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind NR_MISSING_CUSTOM_ATTRS --pretty
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind NR_MISSING_DB_SEGMENT --pretty
```

<!-- role: workflow -->

## Step 3: Run error-flow analysis

```bash
# Error sink classification across all server code
npx tsx scripts/AST/ast-query.ts error-flow src/server/ --pretty

# Count by sink type
npx tsx scripts/AST/ast-query.ts error-flow src/server/ --count

# Also check client-side catch blocks
npx tsx scripts/AST/ast-query.ts error-flow src/shared/ src/ui/ --pretty
```

This shows how errors flow through catch blocks: console, newrelic,
rethrow, swallowed, response, or callback. Focus on `console` sinks --
these are the primary NR integration gaps.

<!-- role: workflow -->

## Step 4: Classify findings

Group the tool observations by severity:

**CRITICAL (server infra blockers):**
- S1: `newrelic` package missing from `dependencies`
- S2: No `newrelic.js` config file at project root

**HIGH (defense-in-depth gaps):**
- `NR_MISSING_ERROR_HANDLER`: catch blocks with `console.error` but no NR
- `NR_MISSING_ERROR_REPORT`: server catch blocks without `noticeError`
- `NR_MISSING_CUSTOM_ATTRS`: auth middleware without NR user attributes
- `NR_MISSING_USER_ID`: auth flow without `setCustomAttribute('userId')`
- `NR_MISSING_UNHANDLED_REJECTION`: missing global error listeners

**MEDIUM:**
- `NR_MISSING_DB_SEGMENT`: ClickHouse queries without custom segments
- `NR_MISSING_ROUTE_TRACK`: missing SPA route tracking
- `NR_MISSING_WEB_VITALS`: no web vitals reporting
- `NR_MISSING_TXN_NAME`: dynamic API routes without transaction names

**LOW:**
- `ERROR_SINK_TYPE` with `sink: 'swallowed'`: silently swallowed errors

<!-- role: workflow -->

## Step 5: Produce report

Output the gap list in the standard audit format:

```
## NR Observability Audit: <scope>

### Summary
- Client NREUM calls: <count>
- Client wrapper calls: <count>
- Client gaps: <count>
- Server APM calls: <count>
- Server gaps: <count>
- Error sinks: console=<n>, newrelic=<n>, rethrow=<n>, swallowed=<n>

### CRITICAL
<list S1/S2 if applicable>

### HIGH
<list each HIGH finding with file:line, kind, and evidence>

### MEDIUM
<list each MEDIUM finding>

### LOW
<list each LOW finding>

### Existing coverage
<list positive observations: NR_NREUM_CALL, NR_REPORT_ERROR_CALL, etc.>
```

<!-- role: guidance -->

## Scope exclusions

Do NOT flag these as gaps:

- NR utility files (`src/shared/utils/newrelic/`): their internal catch
  blocks intentionally fall back to `console.error` when NR itself fails
- Test files: no NR integration expected
- Mock infrastructure (`src/server/mock/`): no NR integration expected
- The `toastError` fallback in `reactQueryIntegration.ts`: this is the
  user-facing complement to the NR error report, not a substitute
