# Component Library Overhaul

> Complexity: D6 S7 Z7 = 6.7
> Duration: F5 C3 = 15h (8-30h)
> Nearest: Consistency Remediation (5.7)
> Branch: sd/component-overhaul
> Created: 2026-03-16
> Pre-flight: CERTIFIED 2026-03-16

## Prompt Sequence

| # | Prompt | Mode | Depends |
|---|--------|------|---------|
| 1 | P01-types.md | Auto | -- |
| 2 | P02-components.md | Manual | 1 |

## Verification Checklist

```bash
pnpm tsc --noEmit
pnpm build
```

## Cleanup

Items go to `component-overhaul-cleanup.md`.
