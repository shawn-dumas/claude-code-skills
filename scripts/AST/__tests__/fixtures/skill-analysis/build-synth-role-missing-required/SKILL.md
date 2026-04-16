---
name: build-synth-role-missing-required
description: Synthetic build skill with role annotations but missing the required emit role.
context: fork
allowed-tools: Read, Bash
---

Build something without any emit sections.

<!-- role: workflow -->

## Step 1: Do the thing

Do it.

<!-- role: guidance -->

## Conventions

Follow the rules.

<!-- role: workflow -->

## Step 2: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
