---
name: visual-compare
description: Side-by-side visual comparison of the local dev environment vs. a remote app environment. Autonomously navigates both browsers through every dashboard page, exercises all filters and interactions, and documents discrepancies in a session report.
context: fork
allowed-tools: Bash(playwright-cli:*), Read, Write, Bash(date:*), Bash(mkdir:*), Bash(sed:*), Bash(diff:*), Bash(cat:*), Bash(grep:*), Bash(sort:*), Bash(wc:*), Bash(head:*), Bash(tail:*), Bash(sleep:*), Bash(bash .claude/skills/visual-compare/scripts/*:*)
argument-hint: <app|app-staging|app-development>
---

Compare the local development environment against a remote app environment side by side.
`$ARGUMENTS` is the remote environment name: one of `app`, `app-staging`, or `app-development`.

**CRITICAL: This skill uses `playwright-cli` (the Bash CLI tool) for ALL browser
interaction. Do NOT use MCP browser tools (`mcp__dashboard-local__*`,
`mcp__dashboard-remote__*`). MCP tools are a completely separate browser
automation layer — they will open different browser instances, collide with
the playwright-cli sessions, and break the comparison workflow. Every browser
command in this skill runs via `Bash(playwright-cli ...)`. If you catch
yourself reaching for an MCP tool, stop and use the equivalent playwright-cli
command instead.**

Uses two named playwright-cli sessions (`-s=local` and `-s=remote`) for browser isolation.
Each session has independent cookies, localStorage, and auth state so Firebase tokens do not collide.

---

<!-- role: workflow -->

## Phase 0: Setup

### Validate argument

`$ARGUMENTS` contains the remote environment name. Parse it:

- If `$ARGUMENTS` contains `app-staging` → `REMOTE_ENV=app-staging`
- If `$ARGUMENTS` contains `app-development` → `REMOTE_ENV=app-development`
- If `$ARGUMENTS` contains `app` (and not `app-staging` or `app-development`) → `REMOTE_ENV=app`
- If `$ARGUMENTS` is empty or does not match any of the above, **only then** ask the user:

  > Which remote environment? `app` (Production), `app-staging` (Staging), or `app-development` (Development)?

**Do NOT ask if the argument is already valid.** The user typed `/visual-compare app`
— that means `REMOTE_ENV=app`. Proceed immediately.

Set `REMOTE_BASE` to `https://$REMOTE_ENV.8flow.com`.

### Create session file

Determine the session timestamp:

```bash
date '+%Y-%m-%d-%H%M'
```

Create the session docs file at `docs/compare-<timestamp>.md` with this header:

```markdown
# Visual Comparison: <REMOTE_ENV> — <YYYY-MM-DD HH:MM>

|                 | Local                 | Remote                         |
| --------------- | --------------------- | ------------------------------ |
| Base URL        | http://localhost:3001 | https://<REMOTE_ENV>.8flow.com |
| Environment     | local                 | <REMOTE_ENV>                   |
| Session started | <YYYY-MM-DD HH:MM>    |                                |

---
```

### Open browsers

Open both browser sessions with persistent profiles (so auth survives reconnects):

```bash
playwright-cli -s=local open http://localhost:3001/signin --persistent --headed
playwright-cli -s=remote open https://<REMOTE_ENV>.8flow.com/signin --persistent --headed
```

---

<!-- role: workflow -->

## Phase 1: Sign-in

Wait 3 seconds, then snapshot both browsers to check for active sessions:

```bash
playwright-cli -s=local snapshot
playwright-cli -s=remote snapshot
```

If either browser shows the sign-in form rather than a dashboard page, ask:

```
Question: Both sign-in pages are open in separate windows (local and remote). Please sign in to both, then click Continue.
Header: Sign-in confirmation
Options:
  - "Continue" -- I have signed in to both environments and am ready to compare screens
```

If both browsers auto-redirected to a dashboard page, skip the question and
proceed directly to Phase 2.

---

<!-- role: workflow -->

## Phase 2: Autonomous comparison

Work through each dashboard page systematically. For each page:

1. **Navigate** both browsers to the same URL path
2. **Wait** for content to load (use snapshot to verify content appeared, not fixed delays)
3. **Align ALL filters** before comparing data (see Filter alignment below)
4. **Snapshot** both browsers (accessibility snapshot for structure and data)
5. **Diff** the two snapshots using the normalized diff method (see Snapshot diffing below)
6. **Analyze** the diff output — categorize differences as structural, data, or expected noise
7. **Exercise** every interactive element per the page's test script (see Dashboard-specific test scripts below). After each interaction, snapshot both and diff again.
8. **Document** findings in the session report

### Browser command patterns

Navigate:
```bash
playwright-cli -s=local goto http://localhost:3001/insights/realtime
playwright-cli -s=remote goto https://<REMOTE_ENV>.8flow.com/insights/realtime
```

Snapshot (primary comparison tool):
```bash
playwright-cli -s=local snapshot
playwright-cli -s=remote snapshot
```

Interact:
```bash
playwright-cli -s=local click e5
playwright-cli -s=remote click e5
```

Fill/type:
```bash
playwright-cli -s=local fill e3 "value"
playwright-cli -s=remote fill e3 "value"
```

Select:
```bash
playwright-cli -s=local select e7 "option-value"
playwright-cli -s=remote select e7 "option-value"
```

Evaluate (for simple DOM queries — must be serializable, no closures):
```bash
playwright-cli -s=local eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
playwright-cli -s=remote eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
```

Run-code (for complex multi-step interactions — supports full Playwright API):
```bash
playwright-cli -s=local run-code "async page => {
  await page.locator('[data-testid=\"filter-select-open-button\"]').click();
  await page.waitForSelector('[data-testid=\"filter-select-search-input\"]');
  await page.locator('[data-testid=\"filter-select-search-input\"]').fill('Scaled Ops');
  await page.waitForTimeout(500);
  const option = page.getByRole('option', { name: 'Scaled Ops', exact: true });
  if (await option.count() > 0) { await option.click(); return 'selected'; }
  return 'not found';
}"
```

**`eval` vs `run-code`:** Use `eval` for one-liner DOM queries (click, read text).
Use `run-code` when you need Playwright locators, `waitForSelector`, multi-step
sequences, or anything that needs `async`/`await`. `eval` passes to
`page.evaluate()` which requires serializable expressions — closures,
`function(){}` wrappers, and complex objects will fail with
"not well-serializable" errors.

**Important:** Ref IDs (e.g., `e5`) are per-session and per-snapshot. Always take a
fresh snapshot of each browser before interacting, and use the refs from THAT snapshot.
The same element will likely have different ref IDs in local vs remote.

### Browser-side JS helpers

Reusable JS snippets are in `.claude/skills/visual-compare/scripts/vc-browser-helpers.js`.
These use testids and DOM queries instead of snapshot ref IDs, so they work
without needing to discover refs from a snapshot first. Read the file for
the full list. Key snippets:

| Snippet | What it does | Usage |
|---|---|---|
| `PAGE_STATUS` | Returns `loaded:N results`, `error:...`, `empty:...`, or `loading` | Check before diffing |
| `OPEN_TEAM_DROPDOWN` | Opens the FilterSelect team dropdown | Then `SEARCH_TEAM` + `CLICK_TEAM_OPTION` |
| `CLICK_UPDATE` | Clicks the Update button (most pages) | After filter alignment |
| `CLICK_REFRESH` | Clicks the Refresh button (Realtime) | After filter alignment |
| `CLICK_SEARCH` | Clicks the Search button (Workstreams) | After filter alignment |
| `CLICK_SHOW_FILTERS` | Expands collapsed filter panel | After Update collapses filters |
| `CLICK_COLUMN_HEADER` | Sorts by column name | Replace `COLUMN_NAME` placeholder |
| `CLICK_TABLE_ROW` | Clicks a row matching text | Replace `MATCH_TEXT` placeholder |
| `CLICK_TAB` | Clicks a tab by name | Replace `TAB_NAME` placeholder |
| `TOGGLE_HIDE_NO_EVENTS` | Toggles the checkbox (Realtime) | Uses `input[type="checkbox"]` |

**Example: Select "Scaled Ops" team on any insight page:**

```bash
playwright-cli -s=local eval "document.querySelector('[data-testid=\"filter-select-open-button\"]')?.click()"
sleep 1
playwright-cli -s=local eval "(function() { var input = document.querySelector('[data-testid=\"filter-select-search-input\"]'); if (!input) return 'no-input'; var s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(input, 'Scaled Ops'); input.dispatchEvent(new Event('input', { bubbles: true })); return 'ok'; })()"
sleep 1
playwright-cli -s=local eval "(function() { var labels = document.querySelectorAll('[data-testid=\"filter-select-option-label\"]'); for (var i = 0; i < labels.length; i++) { if (labels[i].textContent.trim() === 'Scaled Ops') { labels[i].closest('[data-testid=\"filter-select-option\"]')?.click(); return 'ok'; } } return 'not-found'; })()"
```

**Example: Check page status after navigation:**

```bash
playwright-cli -s=local eval "(function() { var main = document.querySelector('main'); if (!main) return 'loading'; var text = main.innerText; if (text.includes('Something went wrong')) return 'error'; var m = text.match(/(Showing \\\\d+ to \\\\d+ of [\\\\d,]+ results)/); return m ? 'loaded:' + m[1] : 'loaded'; })()"
```

### Filter alignment protocol

**Before comparing ANY data, all filters must be identical in both browsers.**

1. After loading a page, snapshot both browsers to read the current filter state
2. Compare EVERY filter — teams, timezone, period/date range, shift length,
   report level, analyzing-by mode, selected users. Check both the displayed
   value AND the URL query params. A mismatch between the displayed value and
   the URL param is itself a bug worth documenting.
3. If any filter defaults differ (e.g., timezone), change the LOCAL browser to
   match the REMOTE browser's defaults — prod is the source of truth
4. Note any default differences as findings (these are local BFF bugs)
5. Only after all filters match, click Update/Refresh/Search to load data
6. When testing a filter change, change the SAME filter to the SAME value in
   both browsers simultaneously, then Update both
7. After Update/Search collapses filters, re-expand them ("Show Filters") and
   verify they still match — the act of submitting can change displayed values

### Interaction checklist

For each page, exercise ALL of the following that are present:

- **Dropdowns/selects**: Open each, verify options match, select different values
- **Multi-selects**: Open, verify list matches, select/deselect items
- **Text inputs**: Change values (e.g., shift length), verify both accept and
  respond to the new value
- **Toggles**: Click each toggle, verify behavior matches
- **Table sorting**: Click column headers, verify sort direction and row order
- **Table row clicks**: Click rows that have drill-down behavior, compare detail views
- **Tabs**: Click each tab, compare content
- **Pagination**: If present, verify result counts match, navigate pages
- **Sub-tables**: In drill-down views, compare all sub-tables (e.g., Productive
  Hosts, Unproductive Hosts, Unclassified Hosts)
- **Date/period selectors**: Try multiple values, compare results
- **Timezone changes**: Test at least 2 different timezones per page

### Snapshot diffing (primary comparison method)

**Never read both full YAML snapshots into context.** Use the helper
scripts in `.claude/skills/visual-compare/scripts/` instead.

After snapshotting both browsers, use the one-line diff:

```bash
# Basic diff (strips refs, cursor, active, dev-only elements, indentation)
bash .claude/skills/visual-compare/scripts/vc-diff.sh "$LOCAL_SNAP" "$REMOTE_SNAP"

# Realtime page (also normalizes ticking durations)
bash .claude/skills/visual-compare/scripts/vc-diff.sh "$LOCAL_SNAP" "$REMOTE_SNAP" --realtime

# Data-focused (compare only table rows, ignores sidebar nesting noise)
bash .claude/skills/visual-compare/scripts/vc-diff.sh "$LOCAL_SNAP" "$REMOTE_SNAP" --rows-only

# Order-independent (same data, different sort = IDENTICAL)
bash .claude/skills/visual-compare/scripts/vc-diff.sh "$LOCAL_SNAP" "$REMOTE_SNAP" --rows-only --sorted
```

Exit codes: `0` = IDENTICAL, `1` = differences found, `2` = error.

**Health check before diffing** — detect errors, loading, empty states:

```bash
bash .claude/skills/visual-compare/scripts/vc-check-health.sh "$LOCAL_SNAP" --session-name local
bash .claude/skills/visual-compare/scripts/vc-check-health.sh "$REMOTE_SNAP" --session-name remote
```

Output: `STATUS:<session>:loaded|error|empty|signin` + `DETAIL:` line.

**Extract specific data** for targeted comparison:

```bash
# Table rows (stripped of indentation)
bash .claude/skills/visual-compare/scripts/vc-extract-rows.sh "$SNAP" --limit 10

# Unique email addresses
bash .claude/skills/visual-compare/scripts/vc-extract-rows.sh "$SNAP" --emails --limit 25

# Result counts
bash .claude/skills/visual-compare/scripts/vc-extract-rows.sh "$SNAP" --results

# Group headings (Per Project/Per BPO names)
bash .claude/skills/visual-compare/scripts/vc-extract-rows.sh "$SNAP" --headings --sorted
```

**Interpreting the diff:**

- Lines only in local (`<`): elements or data the BFF produces that prod
  does not — may be a local bug or a new feature not yet in prod.
- Lines only in remote (`>`): elements or data prod has that local lacks
  — likely a local BFF bug or missing feature.
- Changed lines: same element with different content — compare the values.
  For tables, this surfaces cell-by-cell differences directly.

**Expected diff noise** (ignore these — `[active]` is already stripped
by the normalization sed above):

- `[expanded]` / `[disabled]` on the Refresh button (cooldown timer state)
- Duration values on the Realtime page (tick every second)
- `alert` element content differences
- `[selected]` on tabs (if you clicked different tabs)
- Pagination button state (`[disabled]` on first/last page)
- Open tab lists (remote may have extra browser tabs)
- Indentation differences from sidebar nesting depth (local has one extra
  `generic` wrapper around sidebar content — this causes ALL content lines
  to differ by indentation, making raw full-YAML diff useless for data
  comparison)

**When the diff is large**, triage by category:

1. First check: are there structural differences (missing elements,
   different roles, different nesting depth)? These are UI bugs.
2. Then check: are the same elements present but with different text?
   These are data bugs.
3. For data bugs: do the values differ by a consistent ratio (e.g.,
   all ~1.5x)? That signals a date range bug. Do they differ randomly?
   That signals a query logic bug.

### Additional data analysis

When the diff reveals data discrepancies:

- **Aggregate data**: If totals differ, drill down to day-level to find
  whether the discrepancy is from different date ranges or different per-day
  values.
- **Result counts**: Note any differences in row counts (e.g., 8 vs 9
  results). These often indicate filtering bugs.
- **Display formatting**: Compare how nulls, zeros, and edge cases are
  displayed (e.g., "-" vs "0.00%").
- **Summary stats**: When a detail view shows summary metrics at the top,
  compare each metric individually and note whether differences trace to
  known bugs (like date range differences) or are new issues.

### Bug classification

Classify each discrepancy by which environment has the bug:

- **PROD bug**: Local behaves correctly, remote does not
- **LOCAL bug**: Remote (prod) behaves correctly, local BFF does not
- For display/formatting differences, prod is the source of truth

### Report format

For each comparison state tested, append to the session docs file:

```markdown
## <Page Name> — <description of state> — <HH:MM>

### Filters (aligned)

<List all filter values, confirming they match>

### Visual discrepancies

<List each discrepancy, or "None observed">

### Data discrepancies

<List differences with specific values, or "None observed">

---
```

---

<!-- role: workflow -->

## Phase 3: Session wrap-up

Close both browser sessions:

```bash
playwright-cli -s=local close
playwright-cli -s=remote close
```

Append a summary section to the docs file:

```markdown
## Session Summary

|                     |                     |
| ------------------- | ------------------- |
| Screens compared    | <N>                 |
| Total discrepancies | <N prod + N local>  |
| Session ended       | <HH:MM>             |

### Discrepancy index

#### Production bugs (fix in prod)

<numbered list with page reference>

#### Local BFF bugs (fix before BFF can replace production API)

<numbered list with page reference>

### Behaviors confirmed working identically

<bulleted list organized by page>
```

Output to the user:

```
Session complete. Report saved to: docs/compare-<timestamp>.md

Screens compared: <N>
Prod bugs: <N>
Local BFF bugs: <N>
```

---

<!-- role: reference -->

## Route map

| Screen              | Path                            |
| ------------------- | ------------------------------- |
| Sign-in             | `/signin`                       |
| Realtime            | `/insights/realtime`            |
| User Productivity   | `/insights/user-productivity`   |
| Team Productivity   | `/insights/team-productivity`   |
| Systems             | `/insights/systems`             |
| Workstreams         | `/insights/workstreams`         |
| Microworkflows      | `/insights/microworkflows`      |
| Relays              | `/insights/relays`              |
| Favorites           | `/insights/favorites`           |
| Chat                | `/insights/chat`                |
| User Detail         | `/insights/details`             |

---

<!-- role: reference -->

## Dashboard-specific test scripts

Each page below has a numbered test script. Execute every step in order.

**"Diff" means:** snapshot both browsers, normalize both YAML files, run
`diff` (see "Snapshot diffing" above), and analyze the output. Include
any non-trivial diff output in the session report section for that state.

**"Document" means:** append a report section to the session file for
that test state, including the diff results and your analysis.

When a step says "sort by X", click the column header in BOTH browsers,
then diff. When a step says "click row N", pick the same user/row by
name in both browsers (refs will differ — always take a fresh snapshot
before clicking).

### Realtime (`/insights/realtime`)

1. Select the same team in both browsers, click Refresh in both.
2. **Diff default state**: use the Realtime-specific normalization
   (strip durations) since times tick. The diff should show zero
   structural differences. Any non-duration diff lines are bugs.
   Document.
3. **Sort by EMAIL**: click the EMAIL column header in both. Diff.
   Both should sort alphabetically — diff should be empty.
4. **Sort by STATUS**: click STATUS header in both. Diff. Verify
   grouping (Active/Idle/Locked) is identical.
5. **Sort by FIRST EVENT**: click header in both. Diff.
6. **Toggle "Hide users with no events"**: click the toggle in both.
   Diff. The result count should drop by the same amount. If the
   diff shows different row counts, that is a bug. Document.
7. **Change timezone**: open timezone selector in both, pick the same
   non-default timezone (e.g., UTC or IST). Click Refresh in both.
   Wait for data. Diff — event times should shift by the offset but
   row structure should be identical. Document.
8. **Restore timezone** to the original and Refresh.

### User Productivity (`/insights/user-productivity`)

1. Select the same team in both, click Update in both.
2. **Diff default state**: diff the snapshots. If totals differ by a
   consistent ratio (e.g., all ~1.5x), that reveals a date range
   off-by-one. Document.
3. **Click "Show Filters"** (filters collapse after Update). Re-expand
   in both and diff — verify all filter values still match.
4. **Sort by ACTIVE TIME/DAY**: click the column header in both. Diff.
5. **Sort by APPX. OCCUPANCY**: click in both. Diff.
6. **Drill into a user**: pick a user who appears in both top-25
   lists (search by email). Click that row in both browsers.
7. **User detail — summary row**: diff. This surfaces all 11 metric
   differences in one pass. Document every diff line.
8. **User detail — Productivity By Date tab**: click this tab in both.
   Diff. Each date's values should match exactly. If local has fewer
   date rows, the diff will show them as lines only in remote —
   that's a date boundary bug. Document.
9. **User detail — click a date row**: pick the same date in both.
   Diff — compare TTM Breakdown and AUX Summary values. Document.
10. **User detail — Productivity By Host tab**: click this tab in both.
    Diff. This compares all 3 sub-tables (Productive Hosts,
    Unproductive Hosts, Unclassified Hosts) at once. Document.
11. **Navigate back** to the main User Productivity table.
12. **Change Days Period**: select a different period (e.g., 7 Days)
    in both. Click Update. Diff. Document.
13. **Change timezone**: pick a non-default timezone in both. Click
    Update. Diff — check date boundaries shifted correctly. Document.

### Team Productivity (`/insights/team-productivity`)

1. Select the same team in both, click Update in both.
2. **Diff default state (This Month, Week)**: diff surfaces all row
   differences at once (period ranges, HEAD COUNT, ACTIVE TIME,
   PRODUCTIVE, etc.). Document.
3. **Per Team tab** (default): already diffed in step 2.
4. **Per Project tab**: click this tab in both. Diff. Document.
5. **Per BPO tab**: click this tab in both. Diff. Document.
6. **Change Report Level to Day**: switch to Day in both. Click
   Update. Diff — there should be more rows now. Verify date
   boundaries match. Document.
7. **Change Report Period to Last Month**: switch in both. Click
   Update. Diff. Document.
8. **Change timezone**: pick a non-default timezone (e.g., IST) in
   both. Click Update. Diff — check period boundaries shifted
   correctly. Document.
9. **Restore to This Month / Week / original timezone**.

### Systems (`/insights/systems`)

1. Select the same team in both, click Update in both.
2. **Diff default state (Cards view)**: diff catches summary bar
   differences (Systems, Users, Workstreams, Microworkflows counts)
   AND card content differences in one pass. Document.
3. **Switch to Table view**: click the "Table" radio in both (use
   `eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"`
   if ref-based click fails). Diff. Document.
4. **Sort by Users**: use the sort dropdown in both. Diff.
5. **Sort by Active Time**: change sort in both. Diff.
6. **Switch back to Cards view**.
7. **Drill down — Level 1 (System detail)**: click the same system
   card in both (pick one with meaningful data, e.g., "Google Sheets"
   or "Labelbox"). System cards use `cursor-pointer` class — use
   `eval` if ref click fails. Diff — covers summary row and "Pages
   in [System]" table. Document.
8. **Drill down — Level 2 (Page detail)**: click the same page row
   in both. Diff the summary row. Then click each of the 4 tabs
   and diff after each:
   - **Into Page**: diff
   - **Out of Page**: diff
   - **Within Page**: diff
   - **By User**: diff
   Document each tab.
9. **Drill down — Level 3 (User within page)**: from the By User
   tab, click the same user row in both. Diff. Document.
10. **Navigate back** to the Systems list.
11. **Change "Analyzing by" to User**: switch in both. Click Update.
    Diff. Document.

### Microworkflows (`/insights/microworkflows`)

1. Select the same team in both, click Update in both.
2. **Diff default state**: diff catches summary bar AND table row
   differences in one pass. Document.
3. **Sort by OCCURRENCES**: click the column header in both. Diff.
4. **Sort by USERS**: click in both. Diff.
5. **Drill into a row**: click the same microworkflow row in both
   (match by SOURCE SYSTEM + TARGET SYSTEM). Diff. Document.
6. **Navigate back** to the main table.

### Relays (`/insights/relays`)

1. Select the same team in both, click Update in both.
2. **Diff default state**: diff catches summary stats, row count,
   column headers, and row content. Document.
3. **Sort by 2 columns**: click header in both, diff after each.
4. **Drill into a row** if rows are clickable. Diff. Document.

### Favorites (`/insights/favorites`)

1. Select the same team in both, click Update in both.
2. **Diff default state**: diff catches summary stats, row count,
   column headers, and row content. Document.
3. **Sort by 2 columns**: click header in both, diff after each.
4. **Drill into a row** if rows are clickable. Diff. Document.

### Workstreams (`/insights/workstreams`)

1. Navigate both browsers to `/insights/workstreams`.
2. **Verify Period filter**: before selecting a user or clicking Search,
   snapshot both browsers and compare the Period date range textbox.
   Also compare the URL query params (`dateStart`, `dateEnd`,
   `startTime`, `endTime`). If the displayed date range differs from
   the URL params, that is a display bug. If the defaults differ
   between local and remote, that is a date boundary bug. Document
   both. Align the Period to match remote before proceeding.
3. **Analyzing by User**: both default to "User" mode. Select the same
   user in both (use the search textbox to filter by email). Click
   Search in both.
4. **Re-expand filters**: after Search, click "Show Filters" on both
   browsers and re-verify the Period filter matches. Document any
   post-Search changes.
5. **Diff default state**: use data-focused row extraction. Check
   result counts match. Document.
6. **Drill into a workstream row**: click the same workstream row
   (match by workstream ID) in both browsers. Diff the detail view.
   Document.
7. **Navigate back** to the main Workstreams table.
8. **LAST VISITED column**: check date formatting. Local BFF may return
   raw ClickHouse DateTime64 (`2026-03-20 17:08:52.189`) instead of
   formatted dates (`Mar 20, 2026 5:08 PM`). Note as a display bug.
9. **Sort by WORKSTREAM**: click header in both. Diff rows.
10. **Sort by ACTIVE TIME**: click header in both. Diff rows.
11. **Pagination**: verify result counts match. Navigate to page 2 in
    both, diff.
12. **Analyzing by Workstream**: switch both to "Workstream" mode.
    Enter the same workstream ID in both (use a numeric ID from the
    user view, e.g., `00316998`). Click Search.
13. **Diff Workstream view**: check result counts. If local returns 0
    while remote has data, the BFF endpoint is failing. Check console
    for 500 errors. Document.
14. **Switch back** to User mode for any further tests.

### Users, Teams, Settings — EXCLUDED

**NEVER navigate to `/users`, `/teams`, `/teams/[id]`, or `/settings/*`.**
These are management pages where accidental clicks can modify user roles,
team assignments, or org settings in production. The risk of data
mutation is too high for automated comparison.

### Implementation notes

- **Team re-selection**: Local does NOT persist team selection across
  page navigations. You must re-select the team on EVERY page. Remote
  (prod) persists team selection. This is a known behavior difference —
  note it once in the first page's report, do not re-report it.
- **"Hide users with no events" toggle**: This is an `input[type="checkbox"]`,
  not a `role="switch"`. The ref-based click on the label does not toggle
  it. Use `eval "document.querySelector('input[type=\"checkbox\"]')?.click()"`.
- System cards use `cursor-pointer` class, not `role="button"` — use
  `eval` with `querySelectorAll('[class*="cursor-pointer"]')` to click
  if ref-based click fails.
- The Table radio in Systems is a `[role="radio"]` element — use `eval`
  with `querySelectorAll('[role="radio"]')` to click it if needed.
- Filters collapse after clicking Update — click "Show Filters" to
  re-expand for filter changes.
- Default period: May differ by 1 day between local and remote (known
  date boundary bug class).
- **Console error checking**: When a page shows "Something went wrong",
  read the console log file to identify which BFF endpoint returned 500.
  The console log path is in the playwright-cli output under "Events".

---

<!-- role: reference -->

## Tool reference

**All browser interaction uses `playwright-cli` via the Bash tool — never MCP.**
The `playwright-cli` binary is a CLI wrapper around Playwright that manages
named sessions, persistent browser profiles, and accessibility snapshots.
It is invoked exclusively through `Bash(playwright-cli ...)` tool calls.

| Action     | Local browser                        | Remote browser                        |
| ---------- | ------------------------------------ | ------------------------------------- |
| Navigate   | `playwright-cli -s=local goto <url>` | `playwright-cli -s=remote goto <url>` |
| Snapshot   | `playwright-cli -s=local snapshot`   | `playwright-cli -s=remote snapshot`   |
| Click      | `playwright-cli -s=local click <ref>`| `playwright-cli -s=remote click <ref>`|
| Fill       | `playwright-cli -s=local fill <ref> "val"` | `playwright-cli -s=remote fill <ref> "val"` |
| Select     | `playwright-cli -s=local select <ref> "val"` | `playwright-cli -s=remote select <ref> "val"` |
| Type       | `playwright-cli -s=local type "text"`| `playwright-cli -s=remote type "text"`|
| Evaluate   | `playwright-cli -s=local eval "..."`  | `playwright-cli -s=remote eval "..."`  |
| Run-code   | `playwright-cli -s=local run-code "async page => { ... }"` | `playwright-cli -s=remote run-code "async page => { ... }"` |
| Close      | `playwright-cli -s=local close`      | `playwright-cli -s=remote close`      |

Both sessions support the full set of playwright-cli commands. Use them freely
to interact with the app (click filters, fill forms, expand panels, etc.).

**These are ALL Bash commands.** Every browser action is a `Bash(playwright-cli ...)`
tool call. There are no other browser tools involved. Do NOT use MCP tools.

---

<!-- role: avoid -->

## What NOT to do

- **NEVER navigate to `/users`, `/teams`, `/teams/[id]`, or `/settings/*`.**
  These are management pages where clicks can modify production data.
- **NEVER use MCP browser tools.** All browser interaction must go through
  `playwright-cli` via the Bash tool. Do not use `mcp__dashboard-local__*`
  or `mcp__dashboard-remote__*` tools.
- Do not use a single browser session for both environments — Firebase auth tokens will collide.
- Do not compare data before aligning ALL filters — timezone, team, period,
  shift length, etc. must all match. Prod is the source of truth for defaults.
- Do not stop to ask the user questions during the comparison — work
  autonomously through all pages and interactions. Only ask if you encounter
  a blocker (e.g., page crashes, auth expires).
- Do not report data differences without first checking whether the
  difference traces to a known bug (like date boundary differences). Always
  drill down to confirm root cause.
- Do not interact with a stale snapshot's refs — always take a fresh snapshot
  of each browser before clicking, as ref IDs change between snapshots.
- Do not append to a prior session's docs file — each invocation creates a new timestamped file.
- Do NOT CHANGE ANY DATA (do NOT manipulate users, teams, or URL classifications).
- Do not guess URL paths — use the route map. If a path 404s, check the
  route map before asking the user.
- Do not read full YAML snapshots into context for comparison — use the
  data-focused diffing techniques (row extraction, email extraction,
  result count grep) instead of the raw YAML diff when the full diff is
  dominated by indentation noise.
