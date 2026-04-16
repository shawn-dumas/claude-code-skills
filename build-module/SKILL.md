---
name: build-module
description: Generate a new non-React TypeScript module (utility, transformer, validator, data processor) following G1-G10 principles. Not for React components, hooks, or API handlers -- use the matching skill for those.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Edit, Write
argument-hint: The module name and purpose (e.g., 'calculatePeriodEnds -- compute start/end dates for billing periods')
tier: open
---

Generate a new TypeScript module. `$ARGUMENTS`

The first token is the module name (camelCase). Everything after the first
whitespace (or after `--`) is the description of what the module does.

**Scope guard.** This skill generates pure TypeScript modules -- utilities,
transformers, validators, data processors, formatters, parsers. It does NOT
generate:

- React components, hooks, or providers (use `build-react-component`,
  `build-react-hook`, `build-react-service-hook`, `build-react-provider`)
- API route handlers (use `build-api-handler`)
- Test files for existing modules (use `build-module-test`)
- Fixture builders (use `build-fixture`)

If the description implies React or an API handler, stop and recommend the
correct skill.

<!-- role: workflow -->

## Step 1: Parse the argument

Extract the module name and purpose description. Validate:

- Name is camelCase (e.g., `formatDuration`, `rankOpportunities`,
  `parseMetadata`). If PascalCase is provided, convert to camelCase.
- Description is present and fits in one sentence. If the description
  contains "and" connecting two unrelated responsibilities, flag it --
  this may need to be two modules (G1).

Determine the target directory:

| Module type                        | Target directory                   |
| ---------------------------------- | ---------------------------------- |
| Shared utility (used cross-domain) | `src/shared/utils/<moduleName>/`   |
| Domain-specific utility            | Co-locate with the domain code     |
| Server-only processing             | `src/server/<appropriate-subdir>/` |
| Shared library infrastructure      | `src/shared/lib/<moduleName>/`     |

If the user specifies a path, use it. Otherwise, default to
`src/shared/utils/<moduleName>/`.

<!-- role: workflow -->

## Step 2: Survey the codebase

1. **Check for duplicates.** Grep for the module name and key terms from
   the description across `src/shared/utils/`, `src/shared/lib/`, and
   `src/server/`. If similar functionality exists, report it and ask
   whether to extend the existing module or proceed with a new one.

2. **Read nearby modules.** Read 2-3 modules in the target directory to
   match conventions: file naming, export style, JSDoc patterns, barrel
   file structure, type import patterns.

3. **Check shared types.** Read `src/shared/types/` for existing types
   that the new module should consume rather than redefine. Pay attention
   to branded types in `src/shared/types/brand.ts`.

4. **Check the barrel file.** If the target parent directory has an
   `index.ts`, read it to understand the re-export pattern. The new
   module will need to be added to it.

<!-- role: guidance -->

## Step 3: Design the module

Plan the module's exports, parameters, and return types. Apply G1-G10
rigorously at design time -- it is cheaper to get the API right before
writing code than to refactor after.

### G1: Single job

The module does one thing. Name its job in under 8 words. If the
description requires two paragraphs, split into two modules.

### G2: Explicit inputs, explicit outputs

Every function declares what it needs as parameters and what it returns
as a typed return value. No ambient reads:

- **No `Date.now()` or `new Date()`.** Accept a timestamp or `dayjs`
  instance as a parameter. This makes the function pure and testable
  without mocking the clock.
- **No `Math.random()`.** Accept a seed or random value as a parameter,
  or accept a random function parameter.
- **No `process.env` reads.** If configuration is needed, accept it as
  a parameter or import from the Zod-validated env modules (`clientEnv`
  or `serverEnv`).
- **No global state reads.** No reading from `window`, `document`,
  `localStorage`, or `sessionStorage`. If browser context is needed,
  accept the value as a parameter.

### G3: Duplication threshold

Do not extract shared helpers preemptively. If two functions in the
module share a 3-line pattern, that is fine. Extract only when the
pattern appears 3+ times, the shape is stable, and the extraction makes
call sites simpler.

### G4: Low cyclomatic complexity

Target CC <= 5 per function. Use:

- Early returns and guard clauses instead of nested if/else
- `Record` lookup maps instead of switch statements
- Small focused functions instead of long multi-branch functions

### G5: Parse at boundaries

If the module processes external input (API responses, user input, CSV
rows, URL params, storage values), accept Zod-parsed data. The module
itself does not parse -- it trusts that its caller parsed at the trust
boundary. If the module IS a parser/validator, use Zod schemas and
return typed, branded values.

### G6: Pure core, effects at the edge

Transformation functions are pure: same input, same output, no I/O. If
the module needs to perform I/O (file reads, network calls, database
queries, logging), separate the pure transformation from the effectful
shell:

```
// Pure: transformation logic
export function computeMetrics(data: RawData): Metrics { ... }

// Effectful: thin shell that does I/O then calls the pure core
export function fetchAndComputeMetrics(client: DbClient): Promise<Metrics> {
  const raw = await client.query(...);
  return computeMetrics(raw);
}
```

### G7: Narrow exports

Export only what consumers need. Internal helpers stay unexported. Plan
the public API surface before writing code -- every export is a contract.

### G8: Types as documentation

Type signatures tell the full contract. Use:

- Branded types for IDs (`UserId`, `TeamId`, `WorkstreamId`,
  `OrganizationId` from `@/shared/types/brand`)
- Branded types for measurements (`ISOTimestamp`, `Seconds`, `Percentage`,
  `Email` from `@/shared/types/brand`)
- Discriminated unions for variant types
- `as const` objects + union types instead of enums
- Explicit return type annotations on all exported functions

### G9: Composition over configuration

Write focused functions, not option objects with flag parameters. If a
function needs a `mode` or `type` parameter to switch behavior, it is
two functions. Shared logic (if any) becomes a private helper.

### G10: Fail loud, fail fast

At trust boundaries, throw or return typed errors. No silent swallowing.
No fallback defaults that hide bugs. Use `Error` subclasses or typed
result objects (`{ ok: true; data: T } | { ok: false; error: E }`).

<!-- role: emit -->

## Step 4: Generate the files

Create the target directory with `mkdir -p` if it does not exist.

### 4a. Module file (`<moduleName>.ts`)

- Named exports only. `export function` for each public function.
- No default exports (project convention).
- `export function` syntax for all module-level exports (not `export const
fn = () =>`), except when generic type parameters require arrow syntax
  for `<T>` disambiguation.
- JSDoc on exported functions where the name alone is insufficient to
  understand behavior, parameters, or edge cases. Do not JSDoc
  self-evident functions.
- Internal helpers are plain `function` declarations (not exported).
- Import types from `@/shared/types/` -- do not redefine existing types.
- Use branded types from `@/shared/types/brand` for IDs and measurements.
- If the module defines types used only internally, co-locate them at the
  top of the file. If types will be consumed by other modules, create a
  co-located types file or add to `@/shared/types/`.

### 4b. Barrel file (`index.ts`)

Re-export only the public API:

```ts
export { functionA, functionB } from './<moduleName>';
```

If the module exports types that consumers need, re-export those too:

```ts
export type { MyResult } from './<moduleName>';
```

### 4c. Update parent barrel (if applicable)

If the target parent directory has an `index.ts` barrel file, add the
new module's re-export to it. Follow the existing alphabetical or
grouped ordering.

### 4d. Test file (`<moduleName>.spec.ts`)

Generate a test file following `build-module-test` patterns. The test
must be thorough enough to serve as a regression safety net.

**Strategy selection:**

| Module type             | Strategy                                                        |
| ----------------------- | --------------------------------------------------------------- |
| Pure utility (no I/O)   | Zero mocks. Call functions directly, assert on return values.   |
| Parser/validator        | Zero mocks. Test valid input, invalid input, edge cases.        |
| I/O wrapper             | Mock only at boundaries (fetch, fs, database client).           |
| Transformer + I/O shell | Test pure core with zero mocks. Test shell with boundary mocks. |

**Test structure:**

```ts
import { describe, it, expect } from 'vitest';
import { functionA, functionB } from './<moduleName>';

describe('<moduleName>', () => {
  describe('functionA', () => {
    it('handles the primary use case', () => {
      const result = functionA(input);
      expect(result).toEqual(expected);
    });

    it('handles edge case: empty input', () => { ... });
    it('handles edge case: boundary values', () => { ... });
    it('throws on invalid input', () => { ... });
  });
});
```

**Test coverage targets:**

- Every exported function has at least one test
- Boundary inputs (empty arrays, zero, null/undefined where applicable,
  max values)
- Error paths (invalid input that should throw or return error results)
- Pure functions: test the transformation directly, no mocks needed
- For functions accepting timestamps/dates as parameters (per G2), test
  with specific fixed values -- no `Date.now()` mocking needed

**Test data:**

- Use fixture builders from `src/fixtures/domains/` when testing with
  domain entities. Check `src/fixtures/` for existing builders before
  writing inline test data.
- For simple value inputs (strings, numbers, dates), inline literals
  are fine.
- No `as any`. Use explicit types and `satisfies` for type safety.

**Cleanup:**

- The global `vitest.setup.ts` calls `vi.restoreAllMocks()` in
  `afterEach`. Do not add redundant cleanup.
- If using fake timers, add `afterEach(() => { vi.useRealTimers(); })`.

**Do NOT generate:**

- `// TODO:` markers. Write real, passing tests.
- Snapshot tests.
- Tests that mock internal helpers of the module under test.

<!-- role: workflow -->

## Step 5: Verify

### 5a. TypeScript

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```

Fix any errors in the generated files before proceeding.

### 5b. Cyclomatic complexity

```bash
npx tsx scripts/AST/ast-query.ts complexity <generated-module-file> --pretty
```

Every function must have CC <= 10. If any function exceeds 10, decompose
it before proceeding.

### 5c. Type safety

```bash
npx tsx scripts/AST/ast-query.ts type-safety <generated-module-file> --pretty
```

Zero `as any` casts. Zero bare `as T` at trust boundaries (use Zod
`.parse()` instead). Non-null assertions are acceptable only with a
comment explaining why the value is guaranteed non-null.

### 5d. Branded type verification

Use ast-branded-check to verify branded type usage:

```bash
npx tsx scripts/AST/ast-query.ts branded <generated-files> --pretty
```

If any matches are found, replace the bare `string` with the
corresponding branded type (`UserId`, `TeamId`, `WorkstreamId`,
`OrganizationId`). Import from `@/shared/types/`.

### 5e. Tests

```bash
pnpm vitest run <path-to-spec-file>
```

All tests must pass. If any fail, fix the production code or the test
(whichever is wrong) before finishing.

### 5f. Side effects audit (for modules claiming purity)

```bash
npx tsx scripts/AST/ast-query.ts side-effects <generated-module-file> --pretty
```

If the module was designed as pure (G6), this must return zero
observations. If side effects are detected, either move them to a
separate effectful shell or document why they are necessary.

<!-- role: emit -->

## Summary

After generating and verifying, output a summary:

```
## New Module: <moduleName>

### Purpose
<one sentence>

### Files created
- <path> -- <description>

### Exports
- `functionA(params): ReturnType` -- <what it does>
- `functionB(params): ReturnType` -- <what it does>

### G1-G10 compliance
| Principle | Status | Notes |
|-----------|--------|-------|
| G1 Single Job | PASS | <job description in 8 words> |
| G2 Explicit I/O | PASS | No ambient reads |
| G3 No Bad Abstraction | PASS | N/A (new code) |
| G4 Low Complexity | PASS | Max CC: <N> |
| G5 Parse Don't Validate | PASS | <boundary handling> |
| G6 Pure Core | PASS | <purity status> |
| G7 Narrow Exports | PASS | <N> exports, <N> internal |
| G8 Types as Docs | PASS | <branded types used> |
| G9 Composition | PASS | No flag parameters |
| G10 Fail Fast | PASS | <error handling approach> |

### Verification
- tsc: PASS (0 errors)
- ast-complexity: PASS (max CC: <N>)
- ast-type-safety: PASS (0 violations)
- tests: PASS (<N> specs, <N> passed)
```
