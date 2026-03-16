---
name: extract-shared-presentational
description: Extract a repeated rendering pattern from multiple files into a shared presentational component. Identifies all call sites, creates the component, and replaces inline patterns with component usage.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <ComponentName> <"pattern description"> <file1> <file2> ...
---

Extract a shared presentational component from a repeated rendering pattern.
`$ARGUMENTS`

The first token is the component name (e.g., `ProgressBar`). The quoted string is
a description of the pattern. The remaining tokens are file paths where the pattern
appears (at least 2). If no files are listed, search the codebase for the pattern.

## Step 0: Run AST analysis tools

```bash
# Find JSX pattern structure across source files
for f in <source-files>; do
  npx tsx scripts/AST/ast-jsx-analysis.ts "$f" --pretty
done
npx tsx scripts/AST/ast-imports.ts <source-files> --pretty
```

The JSX analysis emits observations with structural evidence:

- `JSX_RETURN_BLOCK` observations with `returnLineCount`, `returnStartLine`,
  `returnEndLine` evidence
- `JSX_TRANSFORM_CHAIN` observations with `methods` and `chainLength` evidence
- `JSX_TERNARY_CHAIN` observations with `depth` evidence
- `JSX_GUARD_CHAIN` observations with `conditionCount` evidence

Use these observations to confirm the pattern is structurally similar
across files. Compare `JSX_RETURN_BLOCK` line counts and look for matching
`JSX_TRANSFORM_CHAIN` methods evidence. The import observations show
existing component imports to check for duplicates.

For extraction candidates, the `ast-interpret-template` interpreter
produces `EXTRACTION_CANDIDATE` assessments when the same structural
pattern appears in 3+ files with similar JSX observation evidence.

## Step 1: Parse arguments

Extract:

- **ComponentName** (PascalCase)
- **Pattern description** (what the repeated JSX does)
- **Source files** (where the pattern currently lives)

## Step 2: Read all source files

For each source file, find every instance of the pattern. Record:

- The exact JSX (copy it)
- The line numbers
- What varies between instances (the props the shared component needs)
- What is constant (the shared structure)

## Step 3: Design the shared component's Props

Analyze all instances to determine the minimal props interface:

- What values differ between instances? Those become props.
- What is always the same? That is the component's internal structure.
- Are there optional variations? Those become optional props.
- Does any instance need a slot/children? If so, add a `children` prop or a
  render prop for that section.

Keep the props interface as small as possible. If an instance needs a capability
that only 1 of 8 call sites uses, consider whether it belongs in this component
or is a separate concern.

## Step 4: Choose the location

The shared component goes in `src/ui/components/8flow/` if it is a general UI
primitive (progress bar, async content wrapper, stat display). It goes in a
feature's `components/` directory if it is specific to one feature area.

Check for existing similar components before creating a new one. Grep for names
like the pattern description to avoid duplication.

## Step 5: Generate the component

Follow the same rules as `build-react-component`:

### `<ComponentName>.tsx`

- Named export
- Props typed inline or as a named interface
- Tailwind CSS
- `data-testid` on key elements
- No hooks except MAY-remain ambient hooks
- **Template discipline:** Return statement is flat. All derived values are named
  intermediates above the return. No chained ternaries, no inline transforms.

### `index.ts`

```ts
export { ComponentName } from './ComponentName';
```

Re-export types if applicable.

### `<ComponentName>.spec.tsx`

- Renders without crashing
- Renders with minimal props
- Renders with full props
- Visual variations (e.g., different percentages, loading states)
- `// TODO:` for behavior-specific assertions

## Step 6: Replace all call sites

For each source file, replace the inline pattern with the new component:

1. Add the import
2. Replace the inline JSX with `<ComponentName prop1={...} prop2={...} />`
3. Delete any local variables that were only used by the inline pattern
4. If the file has a `useMemo` that computed values only for the inline pattern,
   check if it can be simplified

**Verify each replacement renders identically.** The shared component is a
refactor, not a redesign.

## Type touchpoints

The extracted component's props should reference shared types, not redefine them:

1. Check `src/shared/types/` -- the type may already exist in a domain module.
2. Import from `@/shared/types/<module>`, not from context files or API files.
3. For IDs (`userId`, `workstreamId`, `teamId`, `organizationId`), use branded
   types from `@/shared/types/brand` (`UserId`, `WorkstreamId`, `TeamId`,
   `OrganizationId`).
4. If the extracted component introduces a new type that multiple consumers will
   share, add it to the appropriate domain module in `src/shared/types/`, not
   inline in the component file.

## Step 7: Verify

Run `npx tsc --noEmit` on all changed files. Fix type errors. Run tests for
every file that was modified. Run the new component's tests.

### Step 7b: Intention matcher (MANDATORY -- do not skip)

After tsc and tests pass, run the intention matcher on every file that was
modified (the call sites, not the new shared component). **This step is
mandatory.** Do not skip it. Do not report success without running it and
including the output in your summary.

```bash
npx tsx scripts/AST/ast-refactor-intent.ts <modified-files...> --pretty
```

Check the output:

- **0 UNMATCHED, 0 NOVEL**: proceed to summary.
- **Any UNMATCHED**: investigate. The extraction may have changed behavior
  at a call site.
- **Any NOVEL**: investigate. Novel signals at call sites indicate the
  extraction introduced new behavior.

If the intention matcher flags a signal as ACCIDENTALLY_DROPPED and
investigation confirms it was actually intentional, create a calibration
fixture:

a. Create a directory:
`scripts/AST/ground-truth/fixtures/feedback-<date>-<brief-description>/`

b. Copy the before-file(s) into the directory with a "before-" prefix.
Copy the after-file(s) with an "after-" prefix.

c. Write a `manifest.json`:

```json
{
  "tool": "intent",
  "created": "<ISO date>",
  "source": "feedback",
  "refactorType": "component",
  "beforeFiles": ["before-<filename>"],
  "afterFiles": ["after-<filename>"],
  "expectedClassifications": [
    {
      "kind": "<observation kind that was misclassified>",
      "functionContext": "<containing function name>",
      "expectedClassification": "INTENTIONALLY_REMOVED",
      "actualClassification": "ACCIDENTALLY_DROPPED",
      "notes": "<why this was actually intentional>"
    }
  ],
  "status": "pending"
}
```

Classify ALL signals in the fixture, not just the misclassified one.

d. Note in the summary: "Created calibration fixture:
feedback-<date>-<description>. Run /calibrate-ast-interpreter --tool
intent when 3+ pending fixtures accumulate."

Output a summary:

- Component created at (path)
- Props interface
- Call sites replaced (file:line for each)
- Lines saved (total across all files)
- Type-checking, test results, and intention matcher results
  (matched/unmatched/novel counts)
