# --TEST--DO-NOT-RUN: Blocked Calibration Plan

> Complexity: D6 S5 Z6 = 5.7
> Duration: F4 C3 = 12h (6-24h)
> Nearest: Consistency Remediation (5.7)
> Branch: sd/test-calibration-blocked
> Created: 2026-03-17

## Context

Synthetic calibration fixture for the plan-audit interpreter. Tests that
a plan with a dependency cycle is BLOCKED regardless of score. DO NOT EXECUTE.

Intentional deficiency:
- Dependency cycle: prompt 2 depends on 3, prompt 3 depends on 2

## Standing Elements

- INTEGRATION SCOPE: yes
- FEATURE FLAGS: no
- MIGRATION RISK: n/a

## Prompt Sequence

| # | Prompt | Mode | Depends |
|---|--------|------|---------|
| 1 | test-do-not-run-01-foundation | auto | -- |
| 2 | test-do-not-run-02-refactor | auto | 3 |
| 3 | test-do-not-run-03-tests | manual | 2 |

## Verification Checklist

```bash
pnpm tsc --noEmit
pnpm test --run
pnpm build
```

## Cleanup

Accumulated items go to `test-do-not-run-blocked-cleanup.md`.
