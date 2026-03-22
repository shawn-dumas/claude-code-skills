# Build: [Name]

> Category: build
> Trigger: `/build-[name] <args>`

[One-sentence description of what this skill generates.]

<!-- role: workflow -->
## Step 1: Parse the argument

[Classify the request. Determine which variant to generate.]

<!-- role: workflow -->
## Step 2: Survey the codebase

[Investigate existing patterns. Check for duplicates. Read conventions
from surrounding code.]

AST tools to run:

```bash
# Adjust tools to the domain
npx tsx scripts/AST/ast-query.ts imports <target-dir> --pretty
npx tsx scripts/AST/ast-query.ts complexity <target-dir> --pretty
```

<!-- role: guidance -->
## Conventions

[Rules the generated code must follow. Reference the relevant G1-G10
or React principles. Include branded type requirements, import
conventions, and naming patterns.]

<!-- role: avoid -->
## Anti-patterns

[Patterns the generated code must NOT contain. Show the wrong way
with a brief explanation of why it is wrong.]

```typescript
// WRONG: [description]
[anti-pattern code]
```

<!-- role: emit -->
## Step 3: Generate the files

[File generation instructions. Each subsection is one output file.]

### 3a. `<primary-file>.ts`

[Description of what this file contains.]

```typescript
// [template code]
```

### 3b. `index.ts`

[Barrel export.]

```typescript
export { [Name] } from './[name]';
```

### 3c. `<primary-file>.spec.ts`

[Test file. Reference the matching `/build-*-test` skill for test
conventions.]

```typescript
// [test template code]
```

<!-- role: reference -->
## Type touchpoints

[Where to import types from. Which branded types apply. Which shared
type modules to check before creating new types.]

<!-- role: workflow -->
## Step 4: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
pnpm vitest run <spec-file>
# Domain-specific AST checks
npx tsx scripts/AST/ast-query.ts complexity <generated-file> --pretty
npx tsx scripts/AST/ast-query.ts type-safety <generated-file> --pretty
```

<!-- role: emit -->
## Step 5: Summary

Report what was generated:

- Files created
- Files modified
- Verification results (tsc errors, test pass/fail, AST findings)
