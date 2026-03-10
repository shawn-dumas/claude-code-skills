---
name: sync-orchestrate-poc
description: Audit the orchestrate-poc skill against the current codebase and regenerate all embedded reference data (navigation, roles, tabs, endpoints, types, question options) so the wizard stays accurate.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: (no arguments -- reads the codebase and updates the skill)
---

Sync the orchestrate-poc skill with the current codebase. `$ARGUMENTS`

This skill reads the source-of-truth files for every piece of codebase
data embedded in `.claude/skills/orchestrate-poc/SKILL.md`, compares
them against what the skill currently says, and rewrites any stale
sections. It updates BOTH the reference tables at the bottom AND the
question option lists in the wizard phases, since they mirror each other.

**You MUST update questions and references together.** A tab added to the
navigation hierarchy must also appear in the Q7 (similar tab) options,
the Q6 (dashboard group) option descriptions, the Q11 (existing data)
options if it has a new data type, and the tab-to-domain mapping table.

---

## Source-of-Truth Map

Every piece of embedded data has an authoritative source file. Read
these files to determine the current state of the codebase.

### Group 1: Dashboard Navigation

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Sidebar items | `src/ui/components/8flow/Sidebar/Sidebar.tsx` | Top-level nav links (Insights, Users, Teams) and their role gates |
| Dashboard tabs | `src/ui/page_blocks/dashboard/ui/DashboardNavigation/constants.ts` | `dashboardPages` array: name, link, featureFlag, group |
| Dashboard groups | Same file | `DashboardPageGroup` values |
| Tab page names | `src/shared/constants/dashboard.ts` | `DASHBOARD_PAGES` constant |
| Settings tabs | `src/ui/page_blocks/settings/ui/SettingsNavigation/constants.ts` | `settingsNavItems` array |

### Group 2: Feature Flags

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Flag definitions | `src/shared/hooks/useFeatureFlags/types.ts` | `FeatureFlagsToLoad` constant + `FeatureFlagsShapeSchema` |
| Flag fallbacks | `src/shared/hooks/useFeatureFlags/constants.ts` | `fallbackFlags` + `localAllOnFlags` |

### Group 3: Roles and Permissions

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Role definitions | `src/shared/types/auth.ts` | `Role` constant (all values) |
| Admin roles | `src/ui/constants/index.ts` | `adminRoles` array |
| Dashboard role gate | `src/ui/page_blocks/dashboard/DashboardContent.tsx` | `allowedRoles` in `RequireLoginMaybe` |
| Page-level role gates | `src/pages/users.tsx`, `src/pages/teams/index.tsx`, `src/pages/settings/*.tsx` | `allowedRoles` per page |

### Group 4: Page Routes and Layout

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Insights pages | `src/pages/insights/` directory | All `.tsx` files = route slugs |
| Page filtersType | Each `src/pages/insights/*.tsx` file | `filtersType` in `getLayout` call |
| Page containers | Each page file | Which container component is imported and rendered |
| resolveFilterComponent | `src/ui/page_blocks/dashboard/DashboardLayout.tsx` | Filter type to component mapping |
| Non-dashboard pages | `src/pages/users.tsx`, `src/pages/teams/`, `src/pages/settings/` | Route paths and role gates |

### Group 5: BFF and Mock Routes

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Real API routes | `src/pages/api/` directory (excluding `mock/`) | All route files and HTTP methods |
| Mock API routes | `src/pages/api/mock/` directory | All route files; for each, the response type name if identifiable from imports |

### Group 6: Shared Types

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Type definitions | `src/shared/types/*.ts` (non-schema, non-spec files) | Exported type/interface names and their key fields |
| Zod schemas | `src/shared/types/*.schema.ts` | Schema names (confirms which types have runtime validation) |
| Branded types | `src/shared/types/brand.ts` | All `Brand<>` type aliases and constructor functions |

### Group 7: Fixture System

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Domain fixtures | `src/fixtures/domains/` directory | All `.fixture.ts` files and their exported builder names |
| Scenario fields | `src/fixtures/scenario.ts` | `StandardScenario` interface fields |
| Identity pool | `src/fixtures/identity-pool.ts` | Pool config defaults (userCount, teamCount, etc.) |

### Group 8: Adding-Dashboard-Pages Guide

| Data | Source File | What to Extract |
|------|------------|-----------------|
| Files-touched table | `docs/adding-dashboard-pages.md` | The "Files Summary" table at the bottom |

---

## Step 1: Read All Sources

Read every source file listed above. Use parallel reads where possible
to minimize round trips. For directories, list the contents first, then
read individual files as needed.

Do NOT read the orchestrate-poc SKILL.md yet. Build the current-state
snapshot entirely from source files first, so you are not biased by
stale content.

---

## Step 2: Build the Current-State Snapshot

From the source files, construct these data structures (keep them in
your working memory -- do not write intermediate files):

### 2.1 Navigation Hierarchy

Build an ASCII tree matching the format in the skill's "Navigation
Hierarchy" section. Include:
- Sidebar items with route and role restriction
- Dashboard tab groups with tab names and feature flag keys
- Settings tabs with routes

### 2.2 Roles Table

Build a markdown table with columns: Role, Value, Dashboard, Users,
Teams, Settings. Derive the Yes/No values from the page-level
`allowedRoles` arrays (remember INTERNAL_ADMIN is auto-appended by
RequireRoles, so it always gets "Yes (auto)").

### 2.3 Tab-to-Domain Mapping

Build a markdown table with columns: Tab, page_block Domain, Container,
filtersType. Derive from:
- Tab name from `dashboardPages` array
- Domain from the container import path in each page file
- Container name from the page file's default render
- filtersType from the `getLayout` call in each page file

### 2.4 Mock API Endpoints

Build a markdown table with columns: Domain, Endpoint, Data Type,
Description. Derive from:
- The `src/pages/api/mock/` directory tree (endpoint paths)
- Import statements in each mock route (data type names)
- Categorize by domain based on directory path

### 2.5 Shared Types

Build a markdown table with columns: Type, File, Key Fields. Include
only types that are exported and would be meaningful to a PM choosing
data sources (skip internal helpers, branded types, UI-only types).

### 2.6 Branded Types

Build a comma-separated list of all branded type names from `brand.ts`.

### 2.7 Fixture Domains

List all `.fixture.ts` files and confirm the scenario fields.

### 2.8 Files-Touched Table

Extract from `docs/adding-dashboard-pages.md`.

---

## Step 3: Build the Question Option Lists

From the current-state snapshot, derive these question option lists
that appear in the wizard phases:

### 3.1 Q6 Options (Dashboard Group)

Format: one option per group, listing current tabs in that group.
```
- "People" -- User-focused insights. Current tabs: <comma-separated tab names in People group>
- "Process" -- Workflow insights. Current tabs: <comma-separated tab names in Process group>
- "Platform" -- Integration insights. Current tabs: <comma-separated tab names in Platform group>
```

### 3.2 Q7 Options (Similar Tab)

Format: one option per existing dashboard tab, with a description of
its layout pattern. Each option:
```
- "<Tab Name>" -- <1-sentence description of layout + data pattern>. <filter info>.
```

To get the description, read the container file for each tab to
understand its render pattern (table, charts, KPIs, split panel, etc.).
If a tab's container is too large to fully characterize, use the
existing description from the current SKILL.md as a starting point and
verify it is still accurate.

Always end with:
```
- "None of these" -- This is a novel layout that does not closely match any existing tab.
```

### 3.3 Q5e Options (Non-Dashboard Pages)

Format: one option per non-dashboard page that could be modified.
```
- "<Page Name> (<route>)" -- <1-sentence description> (<role restriction>)
```

Include: Users, Teams, Team Detail, and all Settings pages.

### 3.4 Q11 Options (Existing Data Types)

Format: one option per existing data type that a PM might want to reuse.
Each option:
```
- "<TypeName> (<domain>)" -- <what it contains>. Available via <mock endpoint path>
```

Map types to their mock endpoints. Only include types that represent
data a PM would plausibly want to display (not internal infrastructure
types). Always end with:
```
- "This is new data" -- None of the above match. The BFF team will need to build a new endpoint.
```

---

## Step 4: Read the Current SKILL.md

Now read `.claude/skills/orchestrate-poc/SKILL.md` in full. Identify
every section that contains embedded codebase data.

The sections to compare are at these locations (identified by their
markdown headers and surrounding context):

| Section | Marker | Content Type |
|---------|--------|-------------|
| Q6 options | `### Q6: Dashboard Group` | Question options block |
| Q7 options | `### Q7: Similar Tab` | Question options block |
| Q5e options | `### Q6e: Which Page` | Question options block (Branch E) |
| Q11 options | `### Q11: For Each Entity -- Existing or New` | Question options block |
| Q6 group descriptions | Within Q6 options | Tab lists per group |
| Navigation Hierarchy | `### Navigation Hierarchy` | ASCII tree |
| Roles table | `### Roles` | Markdown table |
| Tab-to-Domain Mapping | `### Tab-to-Domain Mapping` | Markdown table |
| Files Touched table | `### Files Touched When Adding a New Dashboard Tab` | Markdown table |
| Mock API Endpoints | `### Existing Mock API Endpoints` | Markdown table |
| Shared Types | `### Existing Shared Types` | Markdown table |
| Branded Types | `### Branded Types` | Inline list |

---

## Step 5: Diff and Report

Compare each section's current content against what you built in Steps
2-3. Produce a diff report:

```markdown
## Sync Report: orchestrate-poc

### Sections with Changes

| Section | What Changed |
|---------|-------------|
| <section name> | <brief description: e.g., "Added 2 new tabs: X, Y", "Removed System Latency endpoint", "New role: VIEWER"> |

### Sections Unchanged

| Section |
|---------|
| <section name> |

### New Items Not in Skill

- <item type>: <name> (source: <file path>)

### Removed Items Still in Skill

- <item type>: <name> (no longer in <file path>)
```

Output this report to the user. If no changes are detected, report
"orchestrate-poc is up to date with the codebase" and stop.

---

## Step 6: Apply Updates

If changes were detected, update the SKILL.md using the Edit tool.
For each stale section:

1. **Locate the section** by its unique header or surrounding context.
2. **Replace the content** between the section's start and end markers
   with the regenerated version from Steps 2-3.
3. **Preserve formatting** -- match the exact indentation, table
   alignment, and code block style of the surrounding content.

### Update order

Update in this order to avoid offset drift from earlier edits:

1. Reference sections (bottom of file, largest blocks):
   a. Branded Types list (line ~1220)
   b. Shared Types table (line ~1186)
   c. Mock API Endpoints table (line ~1152)
   d. Files Touched table (line ~1134)
   e. Tab-to-Domain Mapping table (line ~1117)
   f. Roles table (line ~1094)
   g. Navigation Hierarchy tree (line ~1063)

2. Question option lists (middle of file, in reverse order):
   a. Q11 options (Phase 3, line ~299)
   b. Q5e options (Branch E, line ~261)
   c. Q7 options (Branch A, line ~160)
   d. Q6 options (Branch A, line ~148)

### Edit rules

- Use the Edit tool with `oldString`/`newString` for each replacement.
  Include enough surrounding context in `oldString` to uniquely identify
  the section (headers above and below, or distinctive boundary lines).
- Do NOT rewrite the entire file. Only replace the specific sections
  that have changed.
- Do NOT change any instructional text, phase descriptions, question
  phrasing, or structural elements of the skill. Only change the
  embedded data.
- Preserve the triple-backtick code blocks around question option
  definitions. The question format must remain parseable.

---

## Step 7: Verify

After all edits:

1. Read the updated SKILL.md in full to confirm:
   - All sections are syntactically valid markdown
   - No orphaned table rows or broken code blocks
   - Question option blocks are properly formatted
   - Reference tables have consistent column counts
   - No duplicate entries

2. Cross-check consistency:
   - Every tab in the Navigation Hierarchy appears in the Tab-to-Domain
     Mapping table
   - Every tab in the Tab-to-Domain Mapping appears in the Q7 options
   - Every tab's feature flag in the Navigation Hierarchy matches what
     is in `FeatureFlagsToLoad`
   - Every type in the Shared Types table that has a mock endpoint
     appears in the Q11 options
   - Every group's tab list in Q6 matches the Navigation Hierarchy

3. Report the final result:

```
## Sync Complete

Updated N sections in orchestrate-poc/SKILL.md.

Changes applied:
- <list each change>

Cross-check: all N consistency checks passed.
```

---

## When to Run This Skill

Run `/sync-orchestrate-poc` after any of these changes:

- A new dashboard tab is added or removed
- A new page route is added
- A feature flag is added, removed, or renamed
- A role is added or its access matrix changes
- A new shared type is added to `src/shared/types/`
- A new mock API endpoint is added to `src/pages/api/mock/`
- A new domain fixture is added to `src/fixtures/domains/`
- The `docs/adding-dashboard-pages.md` guide is updated
- A branded type is added to `src/shared/types/brand.ts`
- A settings page is added or removed

As a rule of thumb: if a PR touches any file in the Source-of-Truth Map
(Step 1), run this skill after merging.
