---
name: refactor-module
description: Refactor a non-React TypeScript module to comply with G1-G10 general code principles. Audits, reports violations, then rewrites.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/module.ts>
---

Refactor the TypeScript module at `$ARGUMENTS`.

## Prerequisite

If you have not run `audit-module` on this file yet, consider doing so first. The audit
produces a scored report and prioritized fix list that prevents duplicate work. If no
audit exists, this skill runs the audit internally in Step 2.

## Step 1: Build the dependency picture

Read the target file. Then read every file it imports -- other local modules, types,
utilities. Also find all consumers of this module (grep for its exports across the
codebase). Build a map of what this module depends on and what depends on it.

This map determines what changes are safe. If a function signature changes, every
consumer must be updated.

## Step 2: Audit (internal)

Run the same G1-G10 audit as `audit-module`. Produce the scorecard and violation list.
If an `audit-module` report was already produced, use that instead of re-auditing. Output
the audit report before proceeding to the rewrite.

## Step 3: Classify and plan

Based on the audit, determine the refactoring strategy:

### If G1 fails (mixed responsibilities)
Plan file splits. Each new file gets one job. Identify which consumers import which
functions, so you can update imports correctly. Name new files after their single job.

### If G2 fails (ambient dependencies)
Identify every function that reads from closures, globals, or env vars. Plan parameter
additions. For env vars, consider a config object passed in or a module-top declaration
block.

### If G3 fails (bad abstractions)
Identify functions with mode/flag parameters. Plan splits into focused functions. Check
call sites -- if all callers pass the same flag value, the flag is dead and the function
can be simplified.

### If G4 fails (high complexity)
Plan refactoring for each hotspot:
- Nested if/else: flatten with early returns
- Switch statements: replace with `Record` lookup maps
- Long functions: extract sub-functions (only if they have a clear single job -- do not
  extract just to shorten)

### If G5 fails (missing parsing at boundaries)
Identify each trust boundary. Plan Zod schema or type guard additions. For existing
`as T` casts, plan replacement with `z.parse()` or `safeParse()`.

### If G6 fails (mixed pure/impure)
Plan extraction of pure transformation functions. The impure wrapper calls the pure
function and handles I/O. Name the pure function after the transformation, not the
side effect.

### If G7 fails (over-broad exports)
Plan export removal for dead exports. Check consumers first -- if an export is only
used in tests, it should still be exported (but consider whether the test should use
the public API instead).

### If G8 fails (loose types)
Plan type tightening: branded types for IDs/timestamps, literal unions for
discriminants, explicit return type annotations. Check `src/shared/types/` for
existing types before defining new ones.

### If G9 fails (configuration over composition)
Plan function splits. Each variant becomes its own function. Shared logic (if any)
becomes a private helper that the variants compose.

### If G10 fails (silent errors)
Plan error surfacing: replace empty catches with rethrows or typed error returns.
Replace fallback defaults at trust boundaries with explicit error handling.

## Step 4: Rewrite

Apply all fixes. Follow these rules:

### Splitting files
- Each new file gets a descriptive name matching its single job.
- Update every import across the codebase that referenced the old module.
- If the old module was re-exported through a barrel file, update the barrel.
- Grep for the old module path after splitting to catch any missed imports.

### Extracting pure functions
- The pure function takes explicit inputs and returns explicit outputs.
- The pure function has no side effects -- no I/O, no mutation, no logging.
- The impure wrapper is thin: fetch data, call pure function, write result.
- Name the pure function after the transformation (`formatDate`, `aggregateMetrics`,
  `rankOpportunities`), not after the I/O operation.

### Flattening complexity
- Replace nested if/else with guard clauses that return early.
- Replace switch statements with `Record<Discriminant, Handler>` lookup maps.
- Replace long conditional chains with lookup tables.
- Do not extract sub-functions purely to reduce line count. Only extract when the
  sub-function has a clear, nameable single job (G1).

### Narrowing exports
- Remove exports for functions with zero consumers.
- If removing an export would break a test that reaches into internals, flag the test
  as a candidate for rewriting (it should test through the public API).

### Tightening types
- Replace bare `string`/`number` with branded types from `src/shared/types/brand.ts`
  where appropriate (IDs, timestamps, durations, emails, URLs, percentages).
- Replace `any` with `unknown` at trust boundaries, narrow with type guards or Zod.
- Replace `enum` with `as const` objects + union types.
- Add explicit return type annotations to exported functions.
- Check `src/shared/types/` for existing domain types before defining new ones.

### Fixing error handling
- Replace empty `catch {}` with `catch (error: unknown) { throw error; }` or
  appropriate error handling.
- Replace `catch (error: any)` with `catch (error: unknown)` and narrow with
  `instanceof` or type guards.
- At trust boundaries, replace silent fallback defaults with explicit parsing
  (Zod `safeParse` that returns a typed result).

### Preserving behavior
- Do not change the observable behavior of the module. Consumers should get the same
  results through the same public API (or an updated API if the old one was unsound).
- If a function's type signature changes, update every consumer.
- If duplication exists between this module and another, flag it in the summary but
  do not consolidate unless the pattern meets the G3 threshold (3+ occurrences, stable
  shape, simpler call sites).

## Type touchpoints

When you encounter inline types during the refactor:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. When you find inline types used cross-module (imported by files in other
   directories), move them to the appropriate domain module in
   `src/shared/types/` and update all import sites.

## Step 5: Verify

Run `npx tsc --noEmit` scoped to the changed files (or the whole project if scoping
is not practical). If TypeScript errors appear in files you touched, fix them before
finishing. If existing tests cover the refactored module or its consumers, run them with
the project's test runner. Report the results in the summary.

## Step 6: Summary

Output a summary:

```
## Refactor: <filename>

### Classification
<module type>

### Before/After scorecard
| Principle | Before | After |
|-----------|--------|-------|
| G1 Single Job | FAIL | PASS |
| ... | ... | ... |

### Changes made
1. <description of change, files affected>
2. ...

### Files created
- <new file path> -- <its single job>

### Files modified
- <file path> -- <what changed>

### Consumer updates
- <consumer file> -- <import path updated / signature adapted>

### Duplication flagged (not consolidated)
- <description of duplication, files involved, why not consolidated>

### Verification
- tsc: PASS/FAIL (<N> errors)
- tests: PASS/FAIL/NO TESTS (<N> passed, <N> failed)
```
