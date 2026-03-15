# document-bff-requirements

Generate BFF requirements documentation for a PoC feature branch. Uses
`ast-bff-gaps` to mechanically extract endpoint gap data and produces a
structured markdown section for `docs/upcoming-poc-features-needing-bff-work.md`.

## When to use

- After completing a PoC prompt sequence that added mock routes and BFF stubs
- When a PM needs to know what BFF work is required for a feature
- When updating the BFF requirements doc after a branch changes

## When NOT to use

- If no mock routes or BFF stubs exist (nothing to document)
- For documenting implemented BFF endpoints (this tool finds gaps, not docs)

## Inputs

The user provides:

1. **Branch name** -- the PoC branch to analyze (e.g., `sd/nga-systems-port`)
2. **Feature name** -- human-readable name for the doc section (e.g., "NGA Systems Port")
3. **API directory** -- the directory under `src/pages/api/` to scan
   (e.g., `src/pages/api/users/data-api/systems/`)
4. **Hook directories** (optional) -- directories containing query hooks
   for cross-referencing (e.g., `src/ui/services/hooks/queries/insights/`)

If analyzing a worktree, set `AST_PROJECT_ROOT` to the worktree path
before running the tool.

## Step 1: Run ast-bff-gaps

Run the BFF gap analysis tool on the target directory:

```bash
# If analyzing the current repo:
npx tsx scripts/AST/ast-bff-gaps.ts <api-directory> --pretty --no-cache

# If analyzing a worktree:
AST_PROJECT_ROOT=<worktree-path> \
  npx tsx scripts/AST/ast-bff-gaps.ts <api-directory> --pretty --no-cache

# With hook cross-referencing:
AST_PROJECT_ROOT=<worktree-path> \
  npx tsx scripts/AST/ast-bff-gaps.ts <api-directory> \
  --hook-dir <hook-directory> --pretty --no-cache
```

Capture the JSON output. Verify observation counts:

```bash
AST_PROJECT_ROOT=<worktree-path> \
  npx tsx scripts/AST/ast-bff-gaps.ts <api-directory> --count --no-cache
```

## Step 2: Run ast-data-layer (optional)

If hook directories were provided, also run ast-data-layer to find
which query hooks reference each endpoint:

```bash
AST_PROJECT_ROOT=<worktree-path> \
  npx tsx scripts/AST/ast-data-layer.ts <hook-directory> --pretty
```

Extract:
- Hook name -> fetchApi URL -> response schema mappings
- These map each BFF stub to the frontend query that consumes it

## Step 3: Find schemas

Search for Zod schemas referenced by the stubs. The `responseSchema`
evidence field on QUERY_HOOK_BFF_GAP observations contains the schema
name. Also search the types directory:

```bash
rg 'ResponseSchema|RequestSchema' src/shared/types/ --type ts
```

## Step 4: Find TODO(blocked) comments

Search the codebase for TODO(blocked) comments related to the feature:

```bash
rg 'TODO\(blocked\)' src/ --type ts --type tsx
```

## Step 5: Group endpoints

Group the BFF_STUB_ROUTE observations by path prefix into logical
endpoint groups. The grouping algorithm:

1. Extract the path segments after the domain prefix
   (e.g., after `/api/users/data-api/systems/`)
2. Group by the first path segment: `confluence/`, `sheets/`,
   `productivity/`, `teams`, etc.
3. Within each group, list endpoints in a markdown table with columns:
   - Endpoint (the API path)
   - Stub file (relative path)
   - Response schema (from query hook cross-reference or schema search)
   - ClickHouse query needed (placeholder: `[FILL IN]`)

## Step 6: Identify BFF collapse opportunities

For each endpoint group with 2+ endpoints:

1. Check if multiple endpoints share a path prefix (e.g., 3 confluence
   endpoints under the same parent)
2. Flag these as "potential collapse" -- the BFF could serve the data
   in fewer round trips
3. Do NOT make the collapse decision -- flag it for human review

This is a heuristic. The tool can detect when multiple query hooks in
the same container reference endpoints under the same path prefix.
Whether they should actually be merged requires domain knowledge.

## Step 7: Generate the document section

Read the template from `TEMPLATE.md` and fill in the placeholders:

- `{{FEATURE_NAME}}` -- the user-provided feature name
- `{{BRANCH_NAME}}` -- the user-provided branch name
- `{{BASE_BRANCH}}` -- detect from git: `git log --oneline --ancestry-path <branch>..HEAD | tail -1`
  or ask the user
- `{{ENDPOINT_GROUPS}}` -- the grouped endpoint tables from Step 5,
  with collapse opportunity notes
- `{{SCHEMA_INVENTORY}}` -- list of Zod schemas found in Step 3
- `{{MOCK_ROUTE_COUNT}}` -- count of MOCK_ROUTE observations
- `{{MOCK_ROUTE_LIST}}` -- brief list of mock route paths
- `{{CHECKLIST_ENDPOINTS}}` -- one checklist item per BFF stub:
  `- [ ] <endpoint path> implemented with real query`
- `{{CHECKLIST_COLLAPSE}}` -- collapse-related checklist items
- `{{TODO_BLOCKED_FILES}}` -- files with TODO(blocked) from Step 4

Sections that require domain knowledge are marked with `[FILL IN]`:
- "What exists today" (description of the feature's UI)
- "ClickHouse query needed" column in endpoint tables
- "Frontend changes needed when BFF is implemented"
- "ClickHouse table/view requirements"

## Step 8: Append to the doc

Read the existing `docs/upcoming-poc-features-needing-bff-work.md`.
Append the generated section with a `---` separator before it.

If a section for this branch already exists, ask the user whether to
replace it or append a new one.

## Step 9: Verify

1. Read the generated section and verify:
   - All BFF stub endpoints are listed
   - Schema names match the actual Zod schemas in the types directory
   - Mock route count matches
   - TODO(blocked) files are listed
2. Compare against the ast-bff-gaps output to confirm nothing was missed.

## Output

The skill produces:
- A new section in `docs/upcoming-poc-features-needing-bff-work.md`
- Console summary: endpoint count, schema count, mock route count,
  collapse opportunities flagged
