---
name: build-nr-client-integration
description: Build New Relic browser agent integration for client-side gaps. Adds global error listeners, user ID custom attributes, web vitals reporting, and auth page naming.
context: fork
allowed-tools: Read, Edit, Write, Grep, Glob, Bash
argument-hint: <gap-id> (e.g., C1, C2, C3 -- see audit-nr-observability output)
tier: open
---

Implement the New Relic browser agent integration for the specified gap(s)
at `$ARGUMENTS`. Each gap ID corresponds to an entry from the
`/audit-nr-observability` output.

For any TS/TSX source query, use the ast-query dispatcher:
`npx tsx scripts/AST/ast-query.ts <query-type> <path>`
Do NOT run `npx tsx scripts/AST/ast-*.ts` directly. Do NOT use `rg`, `sg`,
or the Grep tool on TS/TSX source.

<!-- role: reference -->

## Gap implementations

### C1: Global unhandled rejection/error listeners

**Where:** `src/pages/_app.tsx`

**What to add:**

```typescript
// In _app.tsx, add a useEffect in the App component:
useEffect(() => {
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportErrorToNewRelic(event.reason, { type: 'UnhandledRejection' });
  };
  const handleError = (event: ErrorEvent) => {
    reportErrorToNewRelic(event.error, { type: 'GlobalError' });
  };
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleError);
  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    window.removeEventListener('error', handleError);
  };
}, []);
```

Import `reportErrorToNewRelic` from `@/shared/utils/newrelic`.

### C2: User ID as NR custom attribute

**Where:** `src/shared/utils/newrelic/` (new wrapper) +
`src/ui/providers/context/auth/hooks/useAuthBusinessLogic.ts` (call site)

**What to add:** Add a thin wrapper in the existing NR utility module to
stay consistent with `reportErrorToNewRelic` and `monitorApiCall`:

```typescript
// src/shared/utils/newrelic/setNrUserIdentity.ts
export function setNrUserIdentity(userId: string): void {
  if (typeof window === 'undefined' || !window.NREUM) return;
  window.NREUM.setCustomAttribute('userId', userId);
}
```

Export from the barrel (`src/shared/utils/newrelic/index.ts`), then call
from the auth state handler after the user is confirmed authenticated:

```typescript
import { setNrUserIdentity } from '@/shared/utils/newrelic';

// On auth success:
setNrUserIdentity(user.uid);

// On logout:
setNrUserIdentity('');
```

### C3: Auth page naming in route tracker

**Where:** `src/ui/providers/NewRelicRouteTracker.tsx`

**What to add:** Map auth-related routes to friendly names:

```typescript
const AUTH_PAGE_NAMES: Record<string, string> = {
  '/signin': 'Sign In',
  '/signin-confirm': 'Sign In - Confirm',
  '/signin-error': 'Sign In - Error',
  '/logout': 'Logout',
};

// In the handleRouteChange:
const pageName = AUTH_PAGE_NAMES[url] ?? url;
window.NREUM.setPageViewName(pageName);
```

### C4: Web Vitals reporting

**Where:** New file or `src/pages/_app.tsx`

**What to add:** Install `web-vitals` package and report to NR:

```bash
pnpm add web-vitals
```

```typescript
// In _app.tsx or a new utility:
import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals';

function reportWebVital(metric: { name: string; value: number; id: string }) {
  if (window.NREUM) {
    window.NREUM.addPageAction('WebVital', {
      name: metric.name,
      value: metric.value,
      id: metric.id,
    });
  }
}

// Call once on app mount:
onLCP(reportWebVital);
onINP(reportWebVital);
onCLS(reportWebVital);
onFCP(reportWebVital);
onTTFB(reportWebVital);
```

### C5: Custom performance marks

**Where:** Various -- data fetch boundaries

**What to add:** `performance.mark()` and `performance.measure()` at key
data fetch boundaries. This is lower priority and should be done
incrementally per feature area.

<!-- role: guidance -->

## Rules

- Always run `/audit-nr-observability` first to confirm which gaps exist
- Do NOT modify NR utility files (`src/shared/utils/newrelic/`) unless
  adding a new wrapper function
- Follow the existing NREUM guard pattern: `if (window.NREUM) { ... }`
- All new code must have corresponding tests
- Verify with: `npx tsx scripts/AST/ast-query.ts nr-client <modified-files> --pretty`

<!-- role: workflow -->

## Step 1: Identify the gap

Parse `$ARGUMENTS` to determine which gap(s) to implement (C1, C2, C3, C4, C5).

## Step 2: Read target files

Read the files listed in the gap's "Where" section.

## Step 3: Implement the integration

Apply the code changes described in the gap implementation section.

## Step 4: Write tests

Write or update tests for the modified files. Use fixture builders and
follow the contract-first testing philosophy.

## Step 5: Verify

```bash
# Typecheck
pnpm tsc --noEmit -p tsconfig.check.json

# Run tests for modified files
pnpm vitest run <modified-test-files>

# Verify NR integration detected
npx tsx scripts/AST/ast-query.ts nr-client <modified-files> --pretty
```
