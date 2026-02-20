---
name: migrate-npm-package
description: Upgrade a single npm package across a breaking version boundary. Finds all usage sites, runs codemods, applies grep-driven fixes for deprecated APIs, and verifies.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <package-name> <target-version> [codemod-command]
---

Upgrade the npm package specified in `$ARGUMENTS` to the target version.

The first token is the package name (e.g., `next`, `react-flatpickr`, `react`).
The second token is the target version (e.g., `15`, `4.0.11`, `19`).
Everything after the second token is an optional codemod command to run
(e.g., `npx @next/codemod@latest upgrade`).

## Step 1: Understand the current state

1. Read `package.json` to find the current version and whether the package is a
   production or dev dependency.
2. Read the installed version from `node_modules/<package>/package.json`.
3. Grep the entire source tree for every import of the package:
   - `import ... from '<package>'`
   - `import ... from '<package>/...'`
   - `require('<package>')`
   - `require('<package>/...')`
   - `import type { ... } from '<package>'`

   Record every file that imports the package, and what it imports (named exports,
   default export, type imports).

4. Build a usage map: which APIs from the package are actually used in this
   codebase. This is critical for scoping the migration -- if the package has
   50 breaking changes but the codebase only uses 3 APIs, the migration is small.

## Step 2: Research the migration

Check the package's changelog and migration guide:

```bash
# Check available versions and changelog pointer:
pnpm info <package>@<target-version> --json 2>/dev/null || npm info <package>@<target-version> --json 2>/dev/null
```

If the package has a well-known migration guide URL (Next.js, React, TanStack,
Tailwind, etc.), fetch it. Otherwise, check the GitHub releases page.

For each breaking change in the migration guide:
- Does it affect any API that appears in the usage map from Step 1?
- If yes, record the file, line, old API, new API, and whether a codemod handles it.
- If no, skip it.

Produce a migration checklist of only the relevant breaking changes.

## Step 3: Run codemods (if provided)

If a codemod command was given as the third argument:

```bash
<codemod-command>
```

After running, check what files the codemod modified:

```bash
git diff --name-only
```

Read each modified file to verify the codemod's changes are correct. Record what
the codemod handled and what it missed.

If no codemod command was given, skip this step.

## Step 4: Apply the upgrade

```bash
# For production deps:
pnpm add <package>@<target-version>
# For dev deps:
pnpm add -D <package>@<target-version>
```

If the package has companion type packages (e.g., `@types/react` for `react`),
upgrade those too.

## Step 5: Fix code

For each relevant breaking change from Step 2 that was NOT handled by the codemod:

1. Grep for the deprecated API pattern across all files
2. For each match, read the surrounding code to understand context
3. Apply the fix (edit the file to use the new API)
4. Record what was changed

Common fix patterns:
- **Renamed API**: Find-and-replace the old name with the new name
- **Changed signature**: Update call sites to match the new parameter order/types
- **Removed API**: Replace with the documented alternative
- **Changed default**: Check if existing code relies on the old default; add explicit
  values where needed
- **Changed types**: Update type imports, add new type annotations

When fixing, preserve the existing code style and conventions. Do not refactor
unrelated code.

## Step 6: Handle peerDependency conflicts

After installing, check for peerDependency warnings:

```bash
pnpm install 2>&1 | grep -i "peer" || true
```

If other packages have peerDependency conflicts with the new version:
- Record which packages conflict
- Check if newer versions of those packages resolve the conflict
- If a companion upgrade is needed, note it but do NOT automatically upgrade it
  (that is a separate skill invocation)

## Step 7: Verify

```bash
# Type check
npx tsc --noEmit

# Tests
pnpm test 2>&1 || true

# Lint
pnpm lint 2>&1 || true

# Build
pnpm build 2>&1 || true
```

If any step fails, analyze the errors:
- Are they caused by the migration? Fix them.
- Are they pre-existing? Note them but do not fix unrelated issues.

## Step 8: Summary

Output a structured report:

```
## Migration: <package> <old-version> -> <target-version>

### Files importing this package
<list with import counts>

### Breaking changes (relevant to this codebase)
| Change | Files affected | Fixed by codemod? | Manual fix applied? |
|--------|---------------|-------------------|---------------------|

### Breaking changes (not relevant -- APIs not used)
<list, for documentation>

### Codemod results
<what the codemod changed, what it missed>

### Manual fixes applied
| File | Old code | New code | Reason |
|------|----------|----------|--------|

### Companion upgrades needed
| Package | Current | Needed | Reason |
|---------|---------|--------|--------|

### peerDependency conflicts
<list or "none">

### Verification
- tsc: <pass/fail, error count>
- tests: <pass/fail, failure count>
- lint: <pass/fail>
- build: <pass/fail>

### Files modified
<list>
```
