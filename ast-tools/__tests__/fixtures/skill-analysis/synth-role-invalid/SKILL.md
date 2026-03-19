---
name: synth-role-invalid
description: Tests invalid role name detection (typos).
context: fork
allowed-tools: Read, Bash
---

Invalid role test.

<!-- role: emmit -->

## Step 1: Generate (typo: emmit)

```typescript
const code = true;
```

<!-- role: workflow -->

## Step 2: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```

<!-- role: detectt -->

## Step 3: Check (typo: detectt)

Check something.
