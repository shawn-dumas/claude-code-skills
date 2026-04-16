---
name: synth-role-full
description: Synthetic skill with full role annotations on every heading.
context: fork
allowed-tools: Read, Bash
---

Fully annotated skill for testing role parsing and inheritance.

<!-- role: workflow -->

## Step 1: Do the thing

Do it.

<!-- role: detect -->

## Step 2: Check the thing

### 2a. First check (inherits detect)

Check this.

### 2b. Second check (inherits detect)

Check that.

<!-- role: emit -->

## Step 3: Generate output

```typescript
export function hello() {
  return 'world';
}
```

<!-- role: reference -->

## Background

Some context.

<!-- role: avoid -->

## Anti-patterns

```typescript
// WRONG: do not do this
const bad = true;
```

<!-- role: guidance -->

## Rules

Follow the rules.

<!-- role: workflow -->

## Step 4: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
