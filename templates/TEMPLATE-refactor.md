# Refactor: [Name]

> Category: refactor
> Trigger: `/refactor-[name] <target-path>`

[One-sentence description of what this skill refactors and what target
state it achieves.]

<!-- role: guidance -->
## Prerequisite

Run the matching audit skill first for a prioritized violation report:

```
/audit-[name] <target-path>
```

<!-- role: workflow -->
## Step 0: Run AST analysis tools

```bash
# Adjust tools to the domain
npx tsx scripts/AST/ast-query.ts complexity <target> --pretty
npx tsx scripts/AST/ast-query.ts hooks <target> --pretty
npx tsx scripts/AST/ast-query.ts type-safety <target> --pretty
```

<!-- role: workflow -->
## Step 1: Build the dependency picture

[Read the file. Map imports, exports, consumers, and dependents.]

<!-- role: detect -->
## Step 2: Audit against principles

[Systematically check each relevant principle. Each subsection is one
principle or rule.]

### 2a. [First principle]

[What to look for. What constitutes a violation.]

### 2b. [Second principle]

[What to look for. What constitutes a violation.]

### 2n. [Nth principle]

[Continue for each principle being checked.]

<!-- role: emit -->
## Step 3: Report

[Output the audit findings before rewriting. This documents what was
found and what will be changed.]

```
## Refactor Report: [target]

### Findings
| # | Principle | Violation | Severity |
| - | --------- | --------- | -------- |

### Plan
[ordered list of changes to make]
```

<!-- role: guidance -->
## Step 4: Rewrite

[Rules governing the rewrite. What the target state looks like.
Constraints on the transformation.]

<!-- role: avoid -->
## Common refactoring patterns

[Before/after examples of patterns this skill transforms. The "before"
is the anti-pattern; the "after" is the target. Each subsection is one
pattern.]

### [Pattern name]

**Before (violation):**

```typescript
// [anti-pattern code]
```

**After (compliant):**

```typescript
// [target code]
```

<!-- role: reference -->
## Type touchpoints

[Where to import types from. Which branded types apply. Which shared
type modules to check.]

<!-- role: workflow -->
## Step 5: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm vitest run <spec-file>
# Behavioral preservation check
npx tsx scripts/AST/ast-refactor-intent.ts <before-file> <after-file> --pretty
# Domain-specific AST checks
npx tsx scripts/AST/ast-query.ts complexity <target> --pretty
```

<!-- role: emit -->
## Step 6: Summary

Report what was changed:

- Files changed (with before/after line counts)
- Violations fixed (count by principle)
- Verification results (tsc errors, test pass/fail, intent score)
