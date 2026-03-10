---
name: sync-comments
description: Audit all code comments in scope, delete bad ones, update stale ones, preserve valuable ones. Hybrid audit+refactor in a single pass. No report files -- assessment is output, then changes are applied.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: [path/to/directory-or-file] (optional, defaults to src/)
---

Sync all code comments in `$ARGUMENTS`. If no path is given, default to `src/`.
Assess every comment, delete the bad ones, update the stale ones, leave the
good ones alone. Err on the side of delete.

The JSDoc policy in CLAUDE.md ("JSDoc and Comments" section) defines where
JSDoc is required and where it is not. This skill enforces comment hygiene
but does not add missing JSDoc -- it only updates stale JSDoc and deletes
bad comments.

Do NOT create any markdown files, report files, or documentation files. Output
the assessment directly, then apply changes to source files.

## Comment classification

Every comment falls into exactly one of three categories: DELETE, UPDATE, or
PRESERVE. When in doubt, DELETE.

### DELETE -- remove entirely

| Code | Pattern | Examples |
|------|---------|----------|
| D1 | Commented-out code | `// const old = getStuff();`, `/* if (flag) { ... } */` |
| D2 | Restates the code | `// increment i` above `i++`, `// return the value` above `return val` |
| D3 | Obvious/trivial | `// constructor`, `// default case`, `// render`, `// imports` |
| D4 | Section separators | `// =========`, `// ----------`, `// ***********` |
| D5 | Noise section headers | `// Functions`, `// Variables`, `// Types`, `// Exports`, `// Constants` |
| D6 | End-of-block markers | `// end of function`, `// end of if`, `// closing brace`, `} // MyComponent` |
| D7 | Journal/changelog entries | `// Changed by John on 2024-01-15`, `// v2: refactored to use hooks` |
| D8 | Empty comments | `//`, `/* */`, `// ` (whitespace only) |
| D9 | Stale TODO/FIXME/HACK | `// TODO: fix this`, `// FIXME`, `// HACK` -- UNLESS it is `TODO(production-bug)` |
| D10 | Apologetic/uncertain | `// not sure if this is right`, `// this is a hack`, `// sorry` |
| D11 | Redundant type narration | `// this function takes a string and returns a number` when the type signature already says that |
| D12 | Dead references | Comments referencing variables, functions, files, or behaviors that no longer exist and cannot be updated (the thing they describe is gone) |

### UPDATE -- rewrite to match current code

| Code | Pattern | Action |
|------|---------|--------|
| U1 | Wrong variable/function/parameter name | Replace old name with current name |
| U2 | Wrong behavior description | Rewrite to describe actual current behavior |
| U3 | Wrong values/thresholds/counts | Correct the numbers |
| U4 | Stale JSDoc @param | Update parameter name, type, and description to match current signature |
| U5 | Stale JSDoc @returns | Update return type and description to match current signature |
| U6 | Stale JSDoc @throws | Update or remove if the function no longer throws |
| U7 | Stale JSDoc @example | Update example code to work with current API, or remove if no longer representative |
| U8 | Missing JSDoc @param | Add @param entries for parameters that exist in the signature but are missing from the JSDoc |
| U9 | Wrong file/module path reference | Update to current path |
| U10 | Partially stale | Comment is mostly right but contains one or two wrong details -- fix the details |

### PRESERVE -- do not touch

| Code | Pattern | Why |
|------|---------|-----|
| K1 | `TODO(production-bug)` | Tracked production bug protocol |
| K2 | `eslint-disable` with explanation | Intentional rule suppression with documented reason |
| K3 | Business logic rationale | Explains *why* a non-obvious decision was made (not *what* the code does) |
| K4 | Workaround explanation | Documents a workaround for a known bug, browser quirk, or library limitation, with context |
| K5 | Performance justification | Explains why a less-obvious approach was chosen for performance reasons |
| K6 | External links | Links to GitHub issues, PRs, docs, RFCs, or specs that provide context |
| K7 | Legal/license headers | Copyright notices, license blocks |
| K8 | Type narrowing rationale | Explains why a type assertion or narrowing is necessary and safe |
| K9 | Non-obvious algorithm explanation | Documents a tricky algorithm, formula, or data structure choice that is not self-evident from the code |
| K10 | Warning comments | `// WARNING:`, `// IMPORTANT:`, `// NOTE:` that flag genuinely non-obvious gotchas |

### Gray-zone rules

When a comment does not clearly fit one category:

1. **Can the code speak for itself without this comment?** If yes, DELETE.
2. **Does the comment explain "why" rather than "what"?** If yes, PRESERVE. If
   it explains "what," DELETE (the code already says what).
3. **Would a new developer be confused without this comment?** If yes, PRESERVE
   or UPDATE. If no, DELETE.
4. **Is the comment longer than the code it describes?** Strong signal for
   DELETE unless it is explaining a genuinely complex business rule (K3/K9).
5. **Is it a `// NOTE:` or `// IMPORTANT:` that just restates the code?** The
   prefix does not save it. DELETE.

## Step 1: Inventory files in scope

Glob for all `.ts`, `.tsx`, `.js`, `.jsx` files under the target path. Exclude:
- `node_modules/`
- `.next/`
- `dist/`
- `coverage/`
- `*.spec.ts`, `*.spec.tsx`, `*.test.ts`, `*.test.tsx` (test files have
  different comment norms -- skip them)
- `*.d.ts` (generated type declarations)
- `src/fixtures/` (test fixture files)

Count the files. If more than 200 files are in scope, process them in batches
of 50 to avoid context overflow. Report the total file count before proceeding.

## Step 2: Assess every comment

For each file:

1. Read the file completely.
2. Identify every comment (single-line `//`, multi-line `/* */`, JSDoc `/** */`).
3. Classify each comment using the tables above. Assign exactly one code
   (D1-D12, U1-U10, or K1-K10).
4. For UPDATE comments, determine the correct replacement text by reading the
   surrounding code context.
5. For JSDoc blocks (U4-U8), read the function signature and compare every
   @param, @returns, @throws, and @example against the actual code.

Build the assessment as you go. For each file with at least one DELETE or UPDATE
action, record:

```
<filepath>
  D: <count> deletions
  U: <count> updates
  K: <count> preserved
  Actions:
    L<line>: <code> -- <brief description of what and why>
    L<line>: <code> -- <brief description of what and why>
```

## Step 3: Output the assessment

Before making any changes, output the full assessment. Group by file. Include:

- Total files scanned
- Total files with changes
- Total comments assessed
- Breakdown: DELETE count, UPDATE count, PRESERVE count
- Per-file action list (from Step 2)

This gives visibility into what will change before it happens.

## Step 4: Apply all changes

Process each file. For each file with actions:

1. Apply all DELETEs -- remove the comment entirely. If removing the comment
   leaves a blank line that creates a double-blank-line, remove the extra blank
   line too.
2. Apply all UPDATEs -- replace the old comment text with the corrected text.
   For JSDoc blocks, rewrite the entire block to match the current function
   signature (all @param entries, @returns, @throws, @example).
3. Do not touch PRESERVE comments.

Rules during application:

- **Preserve formatting.** Do not reformat code around the comment. Only touch
  the comment itself (and adjacent blank lines when removing creates doubles).
- **One file at a time.** Read, edit, move on. Do not batch edits across files
  in a single Edit call.
- **JSDoc rewrite format.** When rewriting a JSDoc block:
  - Keep the `/** ... */` delimiters
  - One line per @tag
  - Match the indentation of the original block
  - Include @param for every parameter in the signature
  - Include @returns if the function returns a non-void value
  - Omit @throws unless the function explicitly throws (not just propagates)
  - Omit @example unless you can write a correct, minimal one
  - First line of the JSDoc should be a concise one-sentence description of
    what the function does (the "what"), only if the function name alone is
    not sufficient

## Step 5: Verify

1. Run `npx tsc --noEmit` -- comment changes should never break types, but
   verify. Fix any errors.
2. Run `pnpm test --run` -- comment changes should never break tests, but
   verify. Fix any errors.
3. If either check fails, something went wrong (likely an accidental code
   edit). Investigate and fix before reporting.

## Step 6: Output the summary

Output a final summary. No files -- just text output.

```
## Comment Sync: <scope path>

### Totals
- Files scanned: <N>
- Files modified: <N>
- Comments assessed: <N>
- Deleted: <N>
- Updated: <N>
- Preserved: <N>

### Deletions by category
| Code | Count | Description |
|------|-------|-------------|
| D1   | <N>   | Commented-out code |
| D2   | <N>   | Restates the code |
| ...  | ...   | ... |

### Updates by category
| Code | Count | Description |
|------|-------|-------------|
| U1   | <N>   | Wrong name reference |
| U4   | <N>   | Stale JSDoc @param |
| ...  | ...   | ... |

### Files with most changes
| File | Deleted | Updated | Preserved |
|------|---------|---------|-----------|
| <path> | <N> | <N> | <N> |
| ...    | ... | ... | ... |

### Verification
- tsc: PASS/FAIL
- tests: PASS/FAIL

### Notes
<any observations worth calling out -- e.g., files with unusually high
comment density, patterns that suggest a team habit worth discussing,
JSDoc blocks that were significantly wrong>
```
