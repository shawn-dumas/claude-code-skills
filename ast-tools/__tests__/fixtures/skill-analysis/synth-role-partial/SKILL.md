---
name: synth-role-partial
description: Synthetic build skill with partial role annotations (missing on one heading).
context: fork
allowed-tools: Read, Bash
---

Build something.

<!-- role: workflow -->

## Step 1: Do the thing

Do it.

## Step 2: Generate output

```typescript
export function hello() {
  return 'world';
}
```

<!-- role: workflow -->

## Step 3: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
