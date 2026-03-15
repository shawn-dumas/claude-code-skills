# AST Tool Gaps

When an agent uses `sg` (ast-grep) for a structural code query because no
purpose-built AST tool covers the pattern, it appends an entry here. This
registry is the backlog for AST tool development.

Use the `/build-ast-tool` skill to fill gaps from this list.

## Gap Registry

| Date | Pattern Description | sg Command Used | Suggested AST Tool | Context (skill/prompt) | Status |
| ---- | ------------------- | --------------- | ------------------ | ---------------------- | ------ |
| 2026-03-15 | Branded type field detection (property using primitive where branded type expected) | `sg -p 'userId: string'` | ast-branded-check | build-react-component, build-react-route, build-react-service-hook, build-module | filled (ast-branded-check) |
| 2026-03-15 | Hook consumer reverse lookup (find all files importing a given hook) | `sg -p 'useHookName($$$)' src/` | ast-imports --consumers | refactor-react-hook, refactor-react-provider, refactor-react-service-hook | filled (ast-imports --consumers) |
| 2026-03-15 | User-defined type guard detection | `sg -p '$_($$$): $_ is $_' src/` | ast-type-safety TYPE_GUARD_DECLARATION | audit-type-errors | open |

## Rules

1. **Append, never delete.** When a gap is filled by a new AST tool, change
   its Status to `filled (<tool-name>)`. Do not remove the row.
2. **One row per pattern class**, not per invocation. If `sg -p 'useHookName()'`
   is used in 5 different refactor sessions, that is still one gap entry for
   "find all consumers of a hook by call-site matching."
3. **Status values:** `open`, `filled (<tool-name>)`, `wont-fix (<reason>)`.
   `wont-fix` is for patterns too narrow or too infrequent to justify a tool.
4. **Before using sg**, check this registry. If the pattern already has a
   `filled` entry, use the AST tool instead.
