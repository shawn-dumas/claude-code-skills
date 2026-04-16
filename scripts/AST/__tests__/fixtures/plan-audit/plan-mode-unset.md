# Plan With Unset Modes

> Created: 2026-03-15
> Branch: sd/test
> Complexity: D3 S3 Z3 = 3.0
> Duration: F2 C2 = 6h (3-12h)
> Nearest: Other Plan (4.0)

## Pre-Execution Verification

```bash
pnpm tsc --noEmit
```

## Prompt Dispatch Guide

| # | Prompt | Auto/Manual | Notes |
|---|--------|-------------|-------|
| 01 | first | auto | ok |
| 02 | second | | missing mode |
| 03 | third | complex | not auto or manual |

References cleanup: plan-mode-unset-cleanup.md
