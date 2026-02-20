---
name: audit-npm-deps
description: Audit all npm dependencies. Checks outdated versions, security vulnerabilities, dead/misplaced deps, React peerDep compatibility, and produces a tiered update plan.
context: fork
allowed-tools: Read, Grep, Glob, Bash
argument-hint: <path/to/project> (defaults to cwd)
---

Audit the npm dependencies of the project at `$ARGUMENTS` (default: current working
directory). This is a read-only diagnostic -- do not modify any files. Produce a
complete dependency update plan.

## Step 1: Read package.json

Read `package.json` and record:
- Every direct production dependency (name + version constraint)
- Every direct dev dependency (name + version constraint)
- The package manager (check for `pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`)
- The Node engine constraint (if any)

## Step 2: Check outdated versions

Run the package manager's outdated command with JSON output:

```bash
# For pnpm:
pnpm outdated --format json 2>/dev/null || true
# For npm:
npm outdated --json 2>/dev/null || true
```

For each outdated package, record: current version, wanted (semver-compatible),
latest, and whether the gap is a patch, minor, or major.

## Step 3: Check security vulnerabilities

Run the package manager's audit command:

```bash
# For pnpm:
pnpm audit --json 2>/dev/null || true
# For npm:
npm audit --json 2>/dev/null || true
```

For each vulnerability, record: package, severity (critical/high/moderate/low),
title, whether it is a direct or transitive dependency, and whether the vulnerable
package is in production or dev dependencies.

Separate production-facing vulnerabilities from dev-only vulnerabilities. Dev-only
vulnerabilities (storybook, eslint, vitest chains) are lower priority.

## Step 4: Detect dead dependencies

For each direct dependency in `package.json`, grep the source tree for actual
imports. Use multiple patterns to catch all import styles:

```bash
# For a package named "foo":
# - import ... from 'foo'
# - import ... from 'foo/...'
# - require('foo')
# - require('foo/...')
```

Exclude `node_modules/`, lockfiles, and `package.json` itself from the search.

A dependency is **dead** if it has zero import matches in the source tree, OR if
all matches are type-only imports (e.g., `import type { X } from 'foo'`) and the
package has no runtime side effects.

For type-only imports, note what types are used -- they may need to be inlined or
replaced before the package can be removed.

## Step 5: Detect misplaced dependencies

Check whether any production dependency is only imported from test or e2e files
(files matching `*.spec.*`, `*.test.*`, `e2e/**`, `__tests__/**`). These should be
devDependencies.

Conversely, check whether any devDependency is imported from production source files
(files NOT matching test/e2e patterns). These should be production dependencies.

## Step 6: Check React peerDependency compatibility

If the project uses React, check every React-dependent package for compatibility
with the installed React version AND the next major React version (if one exists):

For each direct dependency that has `react` in its `peerDependencies`:

```bash
# Read the installed package's peerDependencies:
cat node_modules/<package>/package.json | grep -A5 peerDependencies
```

Record:
- The package name and installed version
- The `react` peerDependency constraint
- Whether the current React version satisfies it
- Whether the next major React version (e.g., 19.x) would satisfy it
- If NOT compatible with the next React version, check whether a newer version of
  the package exists that IS compatible

Classify each library:
- **COMPATIBLE**: Current version works with next React major
- **UPGRADE-NEEDED**: A newer version of the package supports the next React major
- **BLOCKER**: No version of the package supports the next React major
- **REPLACEMENT-NEEDED**: Package is abandoned/unmaintained and should be replaced

## Step 7: Produce the tiered update plan

Classify every outdated dependency into tiers:

### Dead dependencies (Tier 0 -- remove)

| Package | Version | Imports | Action |
|---------|---------|---------|--------|

### Misplaced dependencies (Tier 0 -- fix placement)

| Package | Currently in | Should be in | Why |
|---------|-------------|-------------|-----|

### Tier 1: Drop-in updates (no code changes)

Packages where the update is within semver range or an additive minor. Split into:
- **Security-critical patches** (do first)
- **Production dependency patches**
- **Dev dependency patches**

### Tier 2: Minimal changes

Packages that cross a major version boundary but are dev-only, narrowly used, or
have documented migration paths with small blast radius.

### Tier 3: Substantial changes

Packages requiring architectural changes or coordination with other work. For each,
note: breaking changes, migration tools/codemods available, estimated effort,
coordination requirements, and recommended timing.

### React compatibility matrix (if applicable)

Full peerDependency matrix for every React-dependent library.

### Execution order

Numbered steps in dependency order. Security patches first, then cleanup, then
increasingly complex upgrades.

### Residual vulnerability inventory

After completing all recommended updates, what vulnerabilities remain and why
(e.g., transitive deps with no fix available, dev-only chains).

## Output format

```
## Dependency Audit: <project-name>

### Summary
- Direct dependencies: <N> production, <N> dev
- Outdated: <N> (patches: <N>, minors: <N>, majors: <N>)
- Vulnerabilities: <N> critical, <N> high, <N> moderate, <N> low
- Dead dependencies: <N>
- Misplaced dependencies: <N>
- React peerDep blockers: <N>

### Dead dependencies
| Package | Version | Imports | Action |
...

### Misplaced dependencies
| Package | Currently in | Should be in | Why |
...

### Security summary
| Severity | Count | Production? | Root causes |
...

### Tier 1: Drop-in updates
...

### Tier 2: Minimal changes
...

### Tier 3: Substantial changes
...

### React compatibility matrix
| Library | Installed | peerDeps react | Current compat | Next major compat | Status |
...

### Execution order
1. ...
2. ...

### Residual vulnerabilities after updates
| Source | Severity | Production? | Fix |
...
```
