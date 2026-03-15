# AST Tool Gaps

When an agent uses `sg` (ast-grep) for a structural code query because no
purpose-built AST tool covers the pattern, it appends an entry here. This
registry is the backlog for AST tool development.

Use the `/build-ast-tool` skill to fill gaps from this list.

## Gap Registry

| Date | Pattern Description | sg Command Used | Suggested AST Tool | Context (skill/prompt) | Status |
| ---- | ------------------- | --------------- | ------------------ | ---------------------- | ------ |

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
