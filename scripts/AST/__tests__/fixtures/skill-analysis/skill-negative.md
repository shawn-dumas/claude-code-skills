---
name: test-negative-skill
description: Synthetic fixture with stale paths, broken refs, and edge cases.
context: fork
allowed-tools: Read, Bash
---

# test-negative-skill

A skill with intentional problems for negative testing.

## Step 1: Read the file

Read `src/nonexistent/path/that/does/not/exist.ts` first.

Also read `scripts/AST/does-not-exist-tool.ts` for reference.

Check `docs/this-doc-does-not-exist.md` for guidance.

Create a new fetcher in `src/server/aspirational/fetchers.ts` for the migration.

## Step 2: Run commands

```bash
pnpm tsc --noEmit
git status
eslint src/ --fix
npx tsx scripts/AST/ast-complexity.ts src/shared/
docker compose up -d
```

Use `/nonexistent-skill-name` for the next step.

## Step 3: Check table

| Header1 | Header2 | Header3 |
| ------- | ------- | ------- |
| row1    | data    | more    |
| row2    | data    | more    |
| row3    | data    | more    |

Also reference this path in a table:

| File                 | Purpose        |
| -------------------- | -------------- |
| `src/fake/module.ts` | Does not exist |

## No steps here

This section has no step number.

```python
print("not a shell command")
```

```
bare code block without language
pnpm test
```
