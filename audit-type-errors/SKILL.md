---
name: audit-type-errors
description: Run tsc, parse errors, classify by root cause, identify cascading chains, and produce a prioritized fix plan that maximizes errors eliminated per fix.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: [path/to/project-or-feature] (defaults to cwd)
---

Audit TypeScript errors in the project at `$ARGUMENTS` (default: current working
directory). This is a read-only diagnostic -- do not modify any files. Produce a
structured report that groups errors by root cause and prioritizes fixes by
cascade impact (fix one thing, eliminate N errors).

## Step 1: Run tsc and capture structured output

```bash
npx tsc --noEmit --pretty false 2>&1 || true
```

Parse each error line. The format is:
```
file(line,col): error TSxxxx: message
```

Record every error with: file path, line number, column, error code, and message.
Count total errors.

## Step 2: Classify each error by root cause

For each error, read the surrounding code (the file at the reported line) and
classify into one of these categories:

### Import/module errors

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| MISSING_IMPORT | Import path does not resolve | Fix path or install missing package |
| MOVED_FILE | File was moved but imports not updated | Update import paths |
| CIRCULAR_DEP | Circular dependency causes undefined types | Break the cycle |
| MISSING_EXPORT | Imported name does not exist in target module | Add export or fix name |

### Type mismatch errors

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| PROP_MISMATCH | Component receives wrong prop type | Fix the prop type or the value passed |
| RETURN_MISMATCH | Function return type does not match declaration | Fix return type or return value |
| ASSIGNMENT_MISMATCH | Variable assigned incompatible type | Fix type annotation or value |
| ARGUMENT_MISMATCH | Function argument does not match parameter type | Fix argument or parameter type |
| UNION_NARROWING | Value could be null/undefined but used without check | Add guard clause or optional chaining |

### Missing type information

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| IMPLICIT_ANY | Parameter or variable has no type and cannot be inferred | Add type annotation |
| MISSING_PROPERTY | Object literal missing required properties | Add missing properties |
| EXCESS_PROPERTY | Object literal has properties not in the target type | Remove excess properties or widen target type |
| UNKNOWN_PROPERTY | Accessing property that does not exist on the type | Fix property name or add to type |

### Type definition errors

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| DUPLICATE_TYPE | Same name exported from multiple modules | Consolidate to single source in src/types/ |
| INCOMPATIBLE_OVERRIDE | Method override does not match parent signature | Fix override signature |
| GENERIC_CONSTRAINT | Generic type argument does not satisfy constraint | Fix the type argument |
| ENUM_MISMATCH | Enum value used where different enum or string expected | Unify enum types |

### Escape hatch artifacts

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| ANY_PROPAGATION | `any` type propagating through expressions | Type the source, narrowing flows downstream |
| UNSAFE_CAST | `as` cast creates downstream type inconsistency | Remove cast, fix underlying type |
| NON_NULL_VIOLATION | Non-null assertion on value that IS null at runtime | Add proper null check |
| TS_EXPECT_STALE | `@ts-expect-error` on line that no longer has an error | Remove the directive |

### Third-party library errors

| Code | Root cause | Fix pattern |
|------|-----------|-------------|
| LIBRARY_TYPES | Library's type definitions are wrong or outdated | Update @types/ package, or add declaration |
| VERSION_MISMATCH | Types package version mismatched with library version | Align versions |
| MISSING_DECLARATION | No type declarations for library | Install @types/ or write .d.ts |

## Step 3: Identify cascading error chains

Many tsc errors are symptoms of a single root cause. A missing type export
produces errors in every file that imports it. A wrong interface definition
causes prop mismatches in every component that uses it.

For each error, trace backward:
- Is this error caused by a type defined in another file?
- Is the type in that file itself an error (missing property, wrong shape)?
- If so, this error is a **cascade** from the root error.

Group cascading errors into chains:
```
ROOT: src/types/user.ts:15 -- User interface missing `email` property
  CASCADE: src/containers/UserContainer.tsx:42 -- Property 'email' does not exist
  CASCADE: src/components/UserCard.tsx:18 -- Type 'User' is not assignable
  CASCADE: src/components/UserList.tsx:30 -- Property 'email' does not exist
```

Count how many errors each root cause produces. Sort root causes by cascade
count (highest first). These are the highest-leverage fixes.

## Step 4: Cross-reference with known type patterns

Check for these specific high-value patterns from the type refactor plan:

### Duplicate type definitions

Grep for type/interface names that appear in 2+ files:
```bash
# Find all exported type/interface declarations
grep -rn "export \(type\|interface\) " src/ --include="*.ts" --include="*.tsx"
```

Flag any type name that is defined in multiple files -- these are deduplication
targets for `src/types/`.

### `any` concentration

Count `any` usage per file:
```bash
grep -c ": any\|as any\|<any>\|any\[" src/**/*.ts src/**/*.tsx 2>/dev/null | grep -v ":0$"
```

Flag files with 5+ `any` usages. Cross-reference with tsc errors -- files with
many `any` types often have cascading type errors because `any` silences errors
at the source but creates mismatches downstream.

### Unsound type guards

Grep for user-defined type guards:
```bash
grep -rn "): .* is " src/ --include="*.ts" --include="*.tsx"
```

For each type guard, check whether the guard body validates enough properties to
justify the `is T` claim. A guard that checks one property on a 10-field interface
is unsound.

### Trust boundary casts

Grep for `as` casts at data boundaries:
```bash
# JSON.parse casts:
grep -rn "JSON.parse.*) as " src/ --include="*.ts" --include="*.tsx"
# fetch response casts:
grep -rn "\.json().*as " src/ --include="*.ts" --include="*.tsx"
# localStorage casts:
grep -rn "getItem.*as " src/ --include="*.ts" --include="*.tsx"
```

These are not tsc errors (the cast silences them), but they are type safety gaps
that should be noted alongside the explicit errors.

### Non-null assertion hotspots

```bash
grep -c "!\." src/**/*.ts src/**/*.tsx 2>/dev/null | grep -v ":0$" | sort -t: -k2 -nr | head -20
```

Flag files with 3+ non-null assertions.

## Step 5: Produce the prioritized fix plan

Sort fixes by **errors eliminated per fix** (cascade count). The goal is to tell
the developer: "Fix these 10 root causes and 150 of your 244 errors disappear."

## Output format

```
## Type Error Audit: <project-name>

### Summary
- Total tsc errors: <N>
- Unique root causes: <N>
- Cascading errors (symptoms of root causes): <N>
- Estimated errors eliminated by top 10 fixes: <N>

### Error distribution by category
| Category | Count | % |
|----------|-------|---|
| Import/module | ... | |
| Type mismatch | ... | |
| Missing type info | ... | |
| Type definition | ... | |
| Escape hatch artifacts | ... | |
| Third-party library | ... | |

### Error distribution by file (top 20)
| File | Errors | Top category | Root or cascade? |
|------|--------|-------------|-----------------|

### Cascading error chains (sorted by cascade count)
| Root cause | File:Line | Cascade count | Fix |
|-----------|-----------|--------------|-----|
| User interface missing `email` | src/types/user.ts:15 | 23 | Add email: Email to User |
| Missing export from insightsContext | src/providers/...:42 | 18 | Add export |
| ... | ... | ... | ... |

### `any` concentration (files with 5+ occurrences)
| File | `any` count | Classification |
|------|------------|---------------|
| productivityChartBuilders.ts | 78 | Needs typed interfaces |
| ... | ... | ... |

### Duplicate type definitions
| Type name | Defined in | Action |
|-----------|-----------|--------|
| ErrorResponse | 22 API routes | Consolidate to src/types/api.ts |
| QueryOptions | 10 service hooks | Import from src/types/api.ts |
| ... | ... | ... |

### Unsound type guards
| Guard | File | Issue |
|-------|------|-------|
| isUser | ... | Only checks uid, User has 9+ required fields |
| ... | ... | ... |

### Trust boundary gaps (silent -- not tsc errors)
| Pattern | Count | Risk |
|---------|-------|------|
| JSON.parse as T | ... | HIGH |
| fetch .json() as T | ... | HIGH |
| localStorage as T | ... | MEDIUM |

### Non-null assertion hotspots
| File | Count | Pattern |
|------|-------|---------|
| ... | ... | Map lookups / state access / filter access |

### Prioritized fix plan
Ordered by errors eliminated per fix (highest leverage first):

1. [ ] **Fix: <description>** (<N> errors eliminated)
       Root: <file:line>
       Cascades to: <list of affected files>
       Skill: <recommended skill invocation, if applicable>

2. [ ] **Fix: <description>** (<N> errors eliminated)
       ...

### Estimated phases
| Phase | Fixes | Errors eliminated | Cumulative |
|-------|-------|-------------------|-----------|
| Phase 1 (top 5 root causes) | 5 | ~<N> | ~<N>/<total> |
| Phase 2 (next 10 root causes) | 10 | ~<N> | ~<N>/<total> |
| Phase 3 (remaining) | <N> | ~<N> | <total>/<total> |
```
