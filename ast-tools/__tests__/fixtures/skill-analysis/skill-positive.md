---
name: test-positive-skill
description: Synthetic fixture exercising all observation kinds.
context: fork
allowed-tools: Read, Bash
---

# test-positive-skill

A skill with all structural elements present.

## When to use

- Pattern X appears 3+ times

## Prerequisites

Read these files:

1. `scripts/AST/types.ts` -- type definitions
2. `scripts/AST/cli.ts` -- CLI infrastructure
3. `scripts/AST/project.ts` -- project scanning

## Step 0: Pre-flight

Run AST analysis:

```bash
npx tsx scripts/AST/ast-complexity.ts src/shared/utils/ --pretty
pnpm tsc --noEmit -p tsconfig.check.json
pnpm test --run
```

Check the output. Use `/audit-react-feature` on the target.

## Step 1: Define types

Add types to `scripts/AST/types.ts`:

```ts
export interface MyObservation {
  kind: 'MY_KIND';
  file: string;
  line: number;
}
```

## Step 2: Implement

Create `scripts/AST/ast-complexity.ts`:

```ts
import { parseArgs } from './cli';
import { PROJECT_ROOT } from './project';
```

Reference `docs/bff.md` for the API route inventory.

## Step 3: Test

Write tests in `scripts/AST/__tests__/ast-complexity.spec.ts`.

Also see `docs/testing.md` for conventions.

## Step 4: Register

| #   | Task  | Status |
| --- | ----- | ------ |
| 1   | Types | Done   |
| 2   | Tool  | Done   |
| 3   | Tests | Done   |

Use `/build-module-test` to generate test files.

## Step 5: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
npx vitest run --config scripts/AST/vitest.config.mts
pnpm build
```

## Checklist

- [x] Types added to `scripts/AST/types.ts`
- [x] Tool file created
- [ ] Tests written
- [ ] Gap entry updated in `scripts/AST/GAPS.md`
- [ ] CLAUDE.md tool inventory updated
