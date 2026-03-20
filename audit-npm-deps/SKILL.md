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

<!-- role: workflow -->

## Step 0: Run AST import analysis

Run the import graph analyzer on the full source tree. This emits
`STATIC_IMPORT` observations which provide a structured map of which
npm packages are actually imported and from where.

```bash
# Emits STATIC_IMPORT observations with source, specifiers, and isTypeOnly evidence
npx tsx scripts/AST/ast-imports.ts src/ --pretty
```

### Using observations

`STATIC_IMPORT` observations replace grep-based dead-dependency detection:

- `source` evidence: the import specifier (package name or path)
- `specifiers` evidence: named imports
- `isTypeOnly` evidence: whether this is `import type { ... }` (affects dead dep detection)

For dead dependency detection (Step 4), group `STATIC_IMPORT` observations by
`source` where the source is a package name (not a relative/aliased path). Packages
with zero observations are dead. Packages where all observations have `isTypeOnly: true`
are type-only dependencies (may be misplaced to devDependencies).

No interpreter is needed for npm dep auditing -- observation-only consumption.

<!-- role: workflow -->

## Step 1: Read package.json

Read `package.json` and record:

- Every direct production dependency (name + version constraint)
- Every direct dev dependency (name + version constraint)
- The package manager (check for `pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`)
- The Node engine constraint (if any)

<!-- role: workflow -->

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

<!-- role: workflow -->

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

<!-- role: detect -->

## Step 4: Detect dead dependencies

Use `STATIC_IMPORT` observations from ast-imports to detect dead dependencies.

For each direct dependency in `package.json`:

1. Filter `STATIC_IMPORT` observations where `source` matches the package name
   (exact match or starts with `<package>/`)
2. Count total observations for that package

A dependency is **dead** if it has zero `STATIC_IMPORT` observations in the
source tree.

A dependency is **type-only** if ALL observations for it have `isTypeOnly: true`
evidence. Type-only dependencies may be candidates for:

- Moving to devDependencies (if only used in test files)
- Removal (if the types can be inlined or replaced)

Note what types are imported from type-only packages -- they may need to be
inlined before the package can be removed.

<!-- role: detect -->

## Step 5: Detect misplaced dependencies

Check whether any production dependency is only imported from test or integration files
(files matching `*.spec.*`, `*.test.*`, `integration/**`, `__tests__/**`). These should be
devDependencies.

Conversely, check whether any devDependency is imported from production source files
(files NOT matching test/integration patterns). These should be production dependencies.

<!-- role: detect -->

## Step 6: Check peerDependency compatibility

Run the `ast-peer-deps` tool to get structured peerDependency analysis:

```bash
npx tsx scripts/AST/ast-peer-deps.ts . --pretty
```

This emits three observation kinds:

- `PEER_DEP_SATISFIED`: constraint is met by the installed version
- `PEER_DEP_VIOLATED`: constraint is NOT met (version mismatch or not installed)
- `PEER_DEP_OPTIONAL_MISSING`: optional peer is not installed (informational)

For violations, record the package, peer, constraint, installed version, and reason.

For the React compatibility matrix specifically, filter to observations where
`peer` is `react` or `react-dom`:

```bash
npx tsx scripts/AST/ast-peer-deps.ts . --kind PEER_DEP_SATISFIED --pretty | grep -i react
npx tsx scripts/AST/ast-peer-deps.ts . --kind PEER_DEP_VIOLATED --pretty | grep -i react
```

If the project uses React, also check whether the next major React version
(if one exists) would satisfy the constraints. For each React-dependent library:

Classify:

- **COMPATIBLE**: Current version works with current and next React major
- **UPGRADE-NEEDED**: A newer version of the package supports the next React major
- **BLOCKER**: No version of the package supports the next React major
- **REPLACEMENT-NEEDED**: Package is abandoned/unmaintained and should be replaced

<!-- role: emit -->

## Step 7: Produce the tiered update plan

Classify every outdated dependency into tiers:

### Dead dependencies (Tier 0 -- remove)

| Package | Version | Imports | Action |
| ------- | ------- | ------- | ------ |

### Misplaced dependencies (Tier 0 -- fix placement)

| Package | Currently in | Should be in | Why |
| ------- | ------------ | ------------ | --- |

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

<!-- role: emit -->

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

<!-- role: guidance -->

## Report Policy

### TEST ANALYSIS AUTHORITY

When this audit includes test file analysis (e.g., checking whether
test infrastructure deps are actually used), ast-test-analysis output
is authoritative. Every observation marked authoritative=true MUST
become a finding. Do NOT filter, downgrade, or skip authoritative
observations. Specifically:

- MOCK_INTERNAL (confidence >= medium): always report
- MISSING_CLEANUP: always report
- DATA_SOURCING_VIOLATION: always report

### PRIORITY ASSIGNMENT

Use PRIORITY_RULES from ast-config.ts. Do NOT assign priority
subjectively. MOCK_INTERNAL high=P3, medium=P4. MISSING_CLEANUP=P4.
DATA_SOURCING_VIOLATION=P5.

### GAP.md ENFORCEMENT

If you assign `architecture-smell` as the finding kind, you MUST append
to scripts/AST/GAPS.md with pattern class, file example, and what tool
would detect it. No exceptions.

<!-- role: emit -->

## Step 8: Emit structured findings

Write a `.findings.yaml` file next to the raw report. The filename pattern is the same as the raw report but with `.findings.yaml` extension (e.g., `npm-deps--user-frontend--raw.findings.yaml`).

### FindingsFile schema

The YAML must validate against the FindingsFile Zod schema in `scripts/audit/schema.ts`.

```yaml
meta:
  auditTimestamp: "<timestamp from artifacts directory name>"
  auditType: "npm-deps"
  target: "<target directory>"
  agentId: "<agent ID from orchestrator>"
  track: "<fe|bff|cross-cutting>"
  filesAudited: <number>
  date: "<YYYY-MM-DD>"

headline:
  productionDeps: <number>
  devDeps: <number>
  deadDeps: <number>
  vulnerabilities: <number>
  outdated: <number>

findings:
  - contentHash: "<computed by finding-id.ts or manually>"
    file: "<file path>"
    line: <line number>
    kind: "<from canonical vocabulary>"
    priority: "<P1-P5>"
    category: "<bug|dead-code|type-safety|architecture|trust-boundary|test-gap|performance|style>"
    track: "<fe|bff|cross-cutting>"
    description: "<finding description>"
    fix: "<fix action>"
    astConfirmed: <true|false>
    astTool: "<tool name if AST-confirmed>"
    requiresManualReview: <true|false>
```

### Headline fields for npm-deps

| Field | Type | Description |
|-------|------|-------------|
| productionDeps | number | Count of direct production dependencies |
| devDeps | number | Count of direct dev dependencies |
| deadDeps | number | Count of dead (unused) dependencies |
| vulnerabilities | number | Total security vulnerabilities (all severities) |
| outdated | number | Count of outdated dependencies (patch + minor + major) |

### Canonical kind vocabulary

| kind | Source | Maps from |
|------|--------|-----------|
| bug | npm audit | Security vulnerability (critical/high/moderate/low) |
| dead-file | ast-imports | Dead dependency (zero STATIC_IMPORT observations) |
| architecture-smell | Manual | Misplaced dependency (prod vs dev) or type-only dependency in wrong location |
| style | Manual | Outdated dependency (non-security patch/minor/major gap) |

### Rules

1. Every finding from the Tiered Update Plan / Findings section MUST appear in the YAML.
2. Assign `priority` (P1-P5) based on severity. Do NOT assign `concern` -- it is assigned during the triage pass after all agents complete.
3. `stableId` should be omitted or set to `"(new)"` -- it is assigned by the pipeline.
4. `contentHash` can be computed using `npx tsx scripts/audit/finding-id.ts` or by following the algorithm: sha256(file + ':' + line + ':' + kind + ':' + sha256(description)), truncated to 8 hex.
5. Use the canonical kind vocabulary above. If validation fails on `kind`, pick the closest canonical value and describe the specifics in `description`.
6. For multi-file findings, set `file` to the primary representative file and list all affected files in the `files` array.
7. For dependency findings, use `package.json` as the `file` and the line number of the dependency entry.

### Validation

After writing the YAML file, validate it:

```bash
npx tsx scripts/audit/yaml-io.ts --validate <findings-file.yaml>
```

If validation fails, fix the YAML before proceeding.
