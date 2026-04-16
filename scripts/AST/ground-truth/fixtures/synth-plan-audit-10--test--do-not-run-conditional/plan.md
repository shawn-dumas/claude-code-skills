# --TEST--DO-NOT-RUN: Conditional Calibration Plan

> Complexity: D5 S4 Z5 = 4.7
> Duration: F3 C2 = 6h (3-12h)
> Nearest: BFF Audit Fix (3.3)
> Branch: sd/test-calibration-conditional
> Created: 2026-03-17

## Context

Synthetic calibration fixture for the plan-audit interpreter. Tests that
a plan with specific structural gaps scores CONDITIONAL. DO NOT EXECUTE.

Intentional deficiencies:
- No pre-flight mark (-10)
- No accumulated-items section (-10)
- Prompt 02 missing mode (-5)

## Standing Elements

- INTEGRATION SCOPE: yes
- FEATURE FLAGS: n/a
- MIGRATION RISK: not applicable

## Prompt Sequence

| # | Prompt | Mode | Depends |
|---|--------|------|---------|
| 1 | test-do-not-run-01-scaffold | auto | -- |
| 2 | test-do-not-run-02-migrate | | 1 |
| 3 | test-do-not-run-03-validate | manual | 1, 2 |

## Verification Checklist

```bash
pnpm tsc --noEmit
pnpm test --run
```
