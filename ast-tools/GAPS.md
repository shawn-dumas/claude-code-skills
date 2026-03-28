# AST Tool Gaps

When an agent uses `sg` (ast-grep) for a structural code query because no
purpose-built AST tool covers the pattern, it appends an entry here. This
registry is the backlog for AST tool development.

Use the `/build-ast-tool` skill to fill gaps from this list.

## Gap Registry

| Date       | Pattern Description                                                                                    | sg Command Used                                                              | Suggested AST Tool                                | Context (skill/prompt)                                                           | Status                           |
| ---------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------- |
| 2026-03-15 | Branded type field detection (property using primitive where branded type expected)                    | `sg -p 'userId: string'`                                                     | ast-branded-check                                 | build-react-component, build-react-route, build-react-service-hook, build-module | filled (ast-branded-check)       |
| 2026-03-15 | Hook consumer reverse lookup (find all files importing a given hook)                                   | `sg -p 'useHookName($$$)' src/`                                              | ast-imports --consumers                           | refactor-react-hook, refactor-react-provider, refactor-react-service-hook        | filled (ast-imports --consumers) |
| 2026-03-15 | User-defined type guard detection                                                                      | `sg -p '$_($$$): $_ is $_' src/`                                             | ast-type-safety TYPE_GUARD_DECLARATION            | audit-type-errors                                                                | open                             |
| 2026-03-18 | Raw role check detection (roles.includes/indexOf/some with Role member access outside canonical files) | `rg 'roles\.(includes\|indexOf)\(Role\.'`                                    | ast-authz-audit RAW_ROLE_CHECK                    | authz-enforcement plan verification                                              | filled (ast-authz-audit)         |
| 2026-03-18 | Role equality check detection (=== Role.X, !== Role.X outside canonical files)                         | `rg '=== Role\.\|!== Role\.'`                                                | ast-authz-audit RAW_ROLE_EQUALITY                 | authz-enforcement equality check cleanup                                         | filled (ast-authz-audit)         |
| 2026-03-18 | Query/mutation error handling coverage (is isError destructured and used per hook call?)               | `rg 'isError' + manual inspection`                                           | ast-error-coverage QUERY_ERROR_HANDLED/UNHANDLED  | rewrite verification cross-cutting concern tracing                               | filled (ast-error-coverage)      |
| 2026-03-18 | Container behavioral concern checklist (loading/error/empty/permission per container)                  | `rg 'isLoading\|isPending\|isError\|PlaceholderContainer' + manual counting` | ast-concern-matrix CONTAINER*HANDLES*_/MISSING\__ | rewrite verification behavioral dimension tracing                                | filled (ast-concern-matrix)      |
| 2026-03-18 | Export surface extraction from isolated files (no import resolution, works on git refs)                | `git show <ref>:<path> \| grep '^export '`                                   | ast-export-surface EXPORT_SURFACE                 | rewrite verification provenance audit (202 deleted files)                        | filled (ast-export-surface)      |
| 2026-03-18 | Skill file structural analysis (stale paths, broken cross-refs, command inventory, section structure)  | `rg 'tsc --noEmit' .claude/skills/` + manual grep for file paths             | ast-skill-analysis SKILL\_\*                      | doc audit found 40 stale tsc commands and 15+ stale type paths across skills     | filled (ast-skill-analysis)      |
| 2026-03-19 | Number formatting and null/empty display pattern detection (toFixed bypass, wrong placeholders, falsy coalescing on numeric columns, zero/null conflation) | `sg -p '$X.toFixed($$$)' src/` (rg-based detection also used: `rg 'N/A\|--\|toFixed' src/`) | ast-number-format + ast-null-display | display-conventions plan, audit-display-conventions skill | filled (ast-number-format, ast-null-display) |
| 2026-03-20 | Object field/property reference lookup (find all files referencing a specific field name like `active_time_ms` in object access, destructuring, or type definitions) | `rg 'active_time_ms\|idle_time_ms' src/` | ast-field-refs | restore-workstreams P08 standing elements, cleanup normalization work | filled (ast-field-refs) |
| 2026-03-21 | Branded type constructor call-site detection (find all files calling a branded type constructor like `ISOTimestamp()` or `toISOTimestamp()`) | `sg -p 'ISOTimestamp($A)' -l ts src/`, `sg -p 'toISOTimestamp($A)' -l ts src/` | ast-branded-check BRANDED_CONSTRUCTOR_CALL | audit-react-feature dashboard-usage agent, verifying branded type adoption | open |
| 2026-03-25 | JSX component consumer tracing (find all files that render `<Component>` as JSX, not just import the symbol) | `rg '<InsightsFilters' src/` (Grep tool used by Explore agent) | ast-imports JSX_CONSUMER or ast-react-inventory COMPONENT_USAGE | InsightsFiltersContainer deep dive -- `symbol` query finds import specifiers but misses JSX element usage, so `<DashboardLayout>` returned 0 consumers | filled (ast-imports --symbol jsxConsumer flag) |
| 2026-03-25 | Conditional branch classification (classify if/ternary branches by what they dispatch on: per-page type, null guard, error check, feature flag) | Read tool used to manually inspect handleSubmit branches | ast-complexity BRANCH_CLASSIFICATION or new interpreter | InsightsFiltersContainer deep dive -- complexity tool reports 3 ifs and 4 ternaries with line numbers but cannot distinguish a per-filtersType dispatch from a null coalesce fallback | filled (ast-interpret-branch-classification) |

## Rules

1. **Append, never delete.** When a gap is filled by a new AST tool, change
   its Status to `filled (<tool-name>)`. Do not remove the row.
2. **One row per pattern class**, not per invocation. If `sg -p 'useHookName()'`
   is used in 5 different refactor sessions, that is still one gap entry for
   "find all consumers of a hook by call-site matching."
3. **Status values:** `open`, `filled (<tool-name>)`, `wont-fix (<reason>)`.
   `wont-fix` is for patterns too narrow or too infrequent to justify a tool.
4. **Before using sg or rg on TypeScript source**, check this registry. If
   the pattern already has a `filled` entry, use the AST tool instead.
5. **Both sg and rg trigger gap-flagging.** The old rule only required
   gap entries for `sg`. As of 2026-03-20, any `rg` or Grep tool use on
   TypeScript source files (`src/`, `integration/`, `scripts/`) where the
   query is structural (identifier lookup, import/export search, hook call
   detection, mock pattern analysis) also requires a gap entry.
