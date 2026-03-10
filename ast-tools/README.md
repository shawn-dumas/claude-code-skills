# AST Analysis Tools

TypeScript AST analysis tools for audit and refactor skills. Each tool
parses source files with the TypeScript compiler API (via ts-morph) and
outputs structured JSON to stdout.

## Tools

| Tool | What it does |
|------|-------------|
| `ast-imports` | Import/export dependency graph, path alias resolution, barrel chain walking, circular dependency and dead export detection |
| `ast-react-inventory` | Component enumeration, classified hook call inventory, useEffect body analysis, Props interface extraction |
| `ast-jsx-analysis` | JSX template complexity: chained ternaries, complex guards, inline transforms, IIFEs, multi-statement handlers |
| `ast-type-safety` | Type assertion finder: `as any`, double casts, non-null assertions, explicit `any` annotations, trust boundary casts |
| `ast-test-analysis` | Test file analysis: mock target classification, assertion type classification, cleanup analysis, strategy detection, data sourcing |
| `ast-complexity` | Per-function cyclomatic complexity, nesting depth, line counts |

## Prerequisites

- TypeScript 5+
- [ts-morph](https://ts-morph.com/) (devDependency)
- [tsx](https://github.com/privatenumber/tsx) for script execution
- Node 20+

## Installation

1. Copy the contents of this directory into `scripts/AST/` in your project:

   ```bash
   cp -r ~/.claude/skills/ast-tools/ <your-project>/scripts/AST/
   ```

2. Install ts-morph as a dev dependency:

   ```bash
   pnpm add -D ts-morph
   ```

3. Ensure your project has a `tsconfig.json` at its root. The tools'
   `tsconfig.json` extends the root config.

## Customization

Edit the config constants in `types.ts` to match your project's hook
patterns:

### `MAY_REMAIN_HOOKS`

Hooks that are allowed in leaf components without being flagged as
violations. The default list includes common ambient UI hooks:

```typescript
export const MAY_REMAIN_HOOKS = [
  'useBreakpoints',
  'useWindowSize',
  'useClickAway',
  'usePagination',
  'useSorting',
  'useTheme',
  // Add your project's ambient hooks here
] as const;
```

### `KNOWN_CONTEXT_HOOKS`

Context hooks specific to your project. Used as a fallback when import
path classification is ambiguous:

```typescript
export const KNOWN_CONTEXT_HOOKS = [
  'useAuthState',
  'usePosthogContext',
  'useTeams',
  // Add your project's context hooks here
] as const;
```

### `SCOPED_HOOK_PATTERN`

Regex for scoped context hooks (matched separately from the lists above):

```typescript
export const SCOPED_HOOK_PATTERN = /^use\w+Scope$/;
```

## Usage

All tools follow the same invocation pattern:

```bash
npx tsx scripts/AST/<tool>.ts <path> [--pretty]
```

- `<path>` can be a file, directory, or glob pattern (tool-dependent)
- `--pretty` formats the JSON output for readability
- `--help` shows usage information
- Output goes to stdout as JSON; errors go to stderr
- Exit code 0 on success, 1 on error

### Examples

```bash
# Dependency graph for a feature directory
npx tsx scripts/AST/ast-imports.ts src/ui/page_blocks/dashboard/systems --pretty

# Component inventory for all .tsx files in a directory
npx tsx scripts/AST/ast-react-inventory.ts src/ui/page_blocks/dashboard/systems/**/*.tsx --pretty

# JSX template complexity
npx tsx scripts/AST/ast-jsx-analysis.ts src/ui/page_blocks/dashboard/systems/SystemsBlock.tsx --pretty

# Type safety scan
npx tsx scripts/AST/ast-type-safety.ts src/shared/utils/ --pretty

# Test file analysis
npx tsx scripts/AST/ast-test-analysis.ts src/ui/page_blocks/dashboard/systems/__tests__/ --pretty

# Per-function complexity
npx tsx scripts/AST/ast-complexity.ts src/server/processors/systemData.ts --pretty
```

## Verification

The tools have their own tsconfig and vitest config, separate from
the project's main configs:

```bash
# Typecheck the tools
npx tsc --noEmit -p scripts/AST/tsconfig.json

# Run tool tests
npx vitest run --config scripts/AST/vitest.config.mts --reporter=verbose
```

## How skills reference these tools

Each audit and refactor skill that benefits from AST analysis has a
"Step 0: Run AST analysis tools" section at the top of its instructions.
This section tells the agent to run the relevant tools and use the
structured JSON output for the skill's analysis steps. The agent still
reads individual files for context when making classification judgments,
but the tools provide the raw data -- replacing dozens of sequential
Grep/Read calls with a single command.

Skills that previously only had `Read, Grep, Glob` in their
`allowed-tools` now also include `Bash` so they can invoke the tools.
