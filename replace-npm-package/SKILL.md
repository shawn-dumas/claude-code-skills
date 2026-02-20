---
name: replace-npm-package
description: Replace one npm package with another. Maps the old API surface to the new package, rewrites all import sites, removes the old package, adds the new one, and verifies.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <old-package> <new-package> [api-mapping-hints]
---

Replace the npm package specified in `$ARGUMENTS` with a different package.

The first token is the old package name (e.g., `react-hot-toast`).
The second token is the new package name (e.g., `sonner`).
Everything after the second token is optional hints about the API mapping
(e.g., `"toast() -> toast(), <Toaster /> -> <Toaster />"`)

## Step 1: Map the old package's usage

1. Read `package.json` to find the old package's version and dependency type
   (production or dev).

2. Grep the entire source tree for every import of the old package:
   - `import ... from '<old-package>'`
   - `import ... from '<old-package>/...'`
   - `require('<old-package>')`
   - `import type { ... } from '<old-package>'`

3. For each file that imports the old package, read it and record:
   - Which named exports are imported
   - Which default export is imported (if any)
   - How each imported API is used (function calls, JSX components, type
     annotations, re-exports)
   - The surrounding code context (what happens before/after each usage)

4. Produce an **API surface map**: every API from the old package that is actually
   used, with file locations and usage counts.

## Step 2: Map the new package's API

1. Install the new package temporarily (or read its types from npm):

   ```bash
   pnpm add <new-package>
   ```

2. Read the new package's type definitions:
   ```bash
   # Check for TypeScript declarations:
   cat node_modules/<new-package>/package.json | grep -E '"types"|"typings"'
   # Read the declaration file
   ```

3. If the user provided API mapping hints, use them as the starting point.

4. For each API from the old package (from Step 1), find the equivalent in the
   new package:
   - Same name, same signature -> direct replacement
   - Different name, same behavior -> rename import
   - Different signature -> note the transformation needed
   - No equivalent -> flag as a gap that needs custom code

5. Produce an **API mapping table**:

   | Old API | New API | Transformation |
   |---------|---------|---------------|
   | `toast('msg')` | `toast('msg')` | Direct replacement |
   | `toast.success('msg')` | `toast.success('msg')` | Direct replacement |
   | `<Toaster position="top-right" />` | `<Toaster position="top-right" />` | Direct replacement |
   | `toast.custom(jsx)` | `toast.custom(jsx)` | Direct replacement |
   | `toast.dismiss(id)` | `toast.dismiss(id)` | Direct replacement |
   | (no old equivalent) | (new-only API) | N/A |

## Step 3: Rewrite all import sites

For each file that imports the old package:

1. Replace the import statement:
   - Change `from '<old-package>'` to `from '<new-package>'`
   - Rename any imports that differ between packages
   - Add any new imports needed for changed APIs

2. Update each usage site according to the API mapping table:
   - Direct replacements: change the import, done
   - Signature changes: update the call site arguments/props
   - Gaps: implement the replacement logic inline or extract a wrapper

3. If the old package provided a component (e.g., `<Toaster />`), find every
   JSX usage and replace it.

4. If the old package provided global CSS or setup (e.g., styles import), find
   and replace those too.

## Step 4: Remove the old package, verify the new one

```bash
pnpm remove <old-package>
```

If the old package had companion type packages (`@types/<old-package>`), remove
those too.

Check that the new package is correctly installed:

```bash
pnpm list <new-package>
```

## Step 5: Verify

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
- Are they caused by the replacement? Fix them.
- Are they pre-existing? Note them but do not fix unrelated issues.

## Step 6: Summary

Output a structured report:

```
## Replacement: <old-package> -> <new-package>

### API mapping
| Old API | New API | Files affected | Transformation |
|---------|---------|---------------|---------------|

### API gaps (no direct equivalent)
| Old API | Replacement approach | Files affected |
|---------|---------------------|---------------|

### Files modified
| File | Changes |
|------|---------|

### Verification
- tsc: <pass/fail, error count>
- tests: <pass/fail, failure count>
- lint: <pass/fail>
- build: <pass/fail>

### Notes
<any caveats, behavioral differences, or follow-up items>
```
