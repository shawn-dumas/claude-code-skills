---
name: audit-nr-observability
description: Audit New Relic integration gaps across client (NREUM browser agent) and server (OTel SDK exporting to NR via OTLP). Uses ast-nr-client, ast-nr-server, and ast-error-flow to produce a gap list showing where NR observability should be present but is not.
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

- Auditing a feature area for observability gaps
- Verifying OTel integration after adding new error handling
- Checking that new server handlers have recordError/setSpanAttributes
- Pre-deployment observability readiness check

**Do NOT use when:**

- You already know the gaps and want to fix them -- use
  `/build-nr-client-integration` or `/refactor-error-handler`
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

### Server (OTel SDK -> NR via OTLP)

Implemented in PR #1377. The proprietary `newrelic` Node agent was
replaced by the OpenTelemetry SDK exporting to `otlp.nr-data.net`.

| What | File | Status |
|---|---|---|
| `withSpan()` span wrapper | `src/server/lib/otelTracer.ts` | Working |
| `recordError()` error reporting | `src/server/lib/otelTracer.ts` | Working |
| `setSpanAttributes()` custom attrs | `src/server/lib/otelTracer.ts` | Working |
| `withChSegment()` ClickHouse spans | `src/server/lib/withChSegment.ts` | Working |
| OTel SDK bootstrap | `src/instrumentation.ts` + `src/otel-instrumentation.js` | Working |
| HTTP auto-instrumentation | `@opentelemetry/auto-instrumentations-node` | Working |
| `withErrorHandler` -> `recordError` | `src/server/middleware/withErrorHandler.ts` | Working |
| `withAuth` -> `setSpanAttributes` | `src/server/middleware/withAuth.ts` | Working |

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

Server infra (S1-S6) is resolved. Remaining gaps are incremental:

| # | Gap | Priority | Where to fix |
|---|-----|----------|-------------|
| S7 | New handlers missing `recordError` in catch blocks | HIGH | Per-handler catch blocks |
| S8 | New handlers missing `withChSegment` for CH queries | MEDIUM | Per-handler CH calls |

<!-- role: workflow -->

## Step 0: Check OTel SDK is installed and bootstrapped

```bash
# Check OTel packages in dependencies
grep '@opentelemetry' package.json
# Verify instrumentation hook exists
ls src/instrumentation.ts src/otel-instrumentation.js
```

If `@opentelemetry/api` is not in `dependencies` or instrumentation
files are missing, flag as CRITICAL -- OTel SDK not bootstrapped.

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
# Full NR server analysis (detects OTel patterns and gaps)
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --pretty

# Count by kind
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --count

# Positive OTel integration
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind OTEL_TRACER_IMPORT --pretty
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind OTEL_RECORD_ERROR_CALL --pretty
npx tsx scripts/AST/ast-query.ts nr-server src/server/ src/pages/api/ --kind OTEL_SPAN_CALL --pretty

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

**CRITICAL (infra blockers):**
- `NR_MISSING_STARTUP_HOOK`: No `instrumentation.ts` (OTel SDK not bootstrapped)

**HIGH (defense-in-depth gaps):**
- `NR_MISSING_ERROR_HANDLER`: client catch blocks with `console.error` but no NR
- `NR_MISSING_ERROR_REPORT`: server catch blocks without `recordError`
- `NR_MISSING_CUSTOM_ATTRS`: auth middleware without `setSpanAttributes`
- `NR_MISSING_USER_ID`: auth flow without `setCustomAttribute('userId')`
- `NR_MISSING_UNHANDLED_REJECTION`: missing global error listeners

**MEDIUM:**
- `NR_MISSING_DB_SEGMENT`: ClickHouse queries without `withSpan`/`withChSegment`
- `NR_MISSING_ROUTE_TRACK`: missing SPA route tracking
- `NR_MISSING_WEB_VITALS`: no web vitals reporting

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
- Server OTel calls: <count> (imports=<n>, recordError=<n>, setAttrs=<n>, spans=<n>)
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
<list positive observations: NR_NREUM_CALL, NR_REPORT_ERROR_CALL (client), OTEL_TRACER_IMPORT, OTEL_RECORD_ERROR_CALL, OTEL_SPAN_CALL (server), etc.>
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
