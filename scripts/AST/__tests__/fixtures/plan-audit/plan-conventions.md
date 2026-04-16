# Plan With Convention Observations

> Created: 2026-03-15
> Branch: sd/test
> Complexity: D3 S3 Z3 = 3.0
> Duration: F2 C2 = 6h (3-12h)
> Nearest: Other Plan (4.0)

## Pre-Execution Verification

```bash
pnpm tsc --noEmit
```

## Instructions

Use camelCase for variable names.

The client-side code should merge data from both endpoints.

Defer to cleanup any remaining naming issues.

Files to modify: `src/ui/services/hooks/useMyHook.ts`

Use /refactor-react-hook for the hook changes.

References cleanup: plan-conventions-cleanup.md
