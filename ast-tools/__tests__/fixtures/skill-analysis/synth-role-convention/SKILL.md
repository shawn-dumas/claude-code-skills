---
name: synth-role-convention
description: Tests role-aware convention scanning. Storage API in detect section should not trigger drift.
context: fork
allowed-tools: Read, Bash
---

Convention scanning test.

<!-- role: detect -->

## Step 1: Check for direct storage access

Look for patterns like `localStorage.getItem('key')` and
`sessionStorage.setItem('key', value)` in production code.

```typescript
// This code block is in a detect section -- it describes what to look for.
// The convention scanner should NOT flag this as superseded.
if (code.includes('localStorage.getItem')) {
  flag('direct-storage-access');
}
```

<!-- role: emit -->

## Step 2: Generate the replacement

Use the typed storage utilities:

```typescript
import { readStorage } from '@/shared/utils/typedStorage';

const value = readStorage('myKey', MySchema);
```

<!-- role: workflow -->

## Step 3: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
