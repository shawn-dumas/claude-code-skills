# Prompt 03: Verify

## Task

Run final verification. DO NOT EXECUTE -- calibration fixture.

## Files

- `scripts/AST/__tests__/calibration.spec.ts`

## Verification

```bash
pnpm tsc --noEmit
pnpm test --run
pnpm build
```

## Reconciliation

```
Status: not started
Files changed: (none)
Tests: (none)
Notes: calibration fixture, not a real prompt
```
