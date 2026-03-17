# --TEST--DO-NOT-RUN: Certified Calibration Plan

> Complexity: D4 S3 Z3 = 3.3
> Duration: F2 C1 = 1.5h (1-3h)
> Nearest: Post-Audit Cleanup (2.7)
> Branch: sd/test-calibration-certified
> Created: 2026-03-17

## Context

Synthetic calibration fixture for the plan-audit interpreter. Tests that
a structurally complete plan with prompt files, cleanup reference, and
standing elements scores CERTIFIED. DO NOT EXECUTE.

## Standing Elements

- INTEGRATION SCOPE: no
- FEATURE FLAGS: n/a
- MIGRATION RISK: not applicable

## Prompt Sequence

| # | Prompt | Mode | Depends |
|---|--------|------|---------|
| 1 | test-do-not-run-01-setup | auto | -- |
| 2 | test-do-not-run-02-implement | auto | 1 |
| 3 | test-do-not-run-03-verify | manual | 2 |

## Verification Checklist

```bash
pnpm tsc --noEmit
pnpm test --run
pnpm build
```

## Cleanup

Accumulated items go to `test-do-not-run-certified-cleanup.md`.
