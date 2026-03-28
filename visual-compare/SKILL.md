---
name: visual-compare
description: Side-by-side visual comparison of the local dev environment vs. a remote app environment. Autonomously navigates both browsers through every dashboard page, exercises all filters and interactions, and documents discrepancies in a session report.
context: fork
allowed-tools: Bash(agent-browser:*), Read, Write, Bash(date:*), Bash(mkdir:*), Bash(sed:*), Bash(diff:*), Bash(cat:*), Bash(grep:*), Bash(sort:*), Bash(wc:*), Bash(head:*), Bash(tail:*), Bash(sleep:*)
argument-hint: <app|app-staging|app-development>
---

Compare the local development environment against a remote app environment side by side.
`$ARGUMENTS` is the remote environment name: one of `app`, `app-staging`, or `app-development`.

**CRITICAL: This skill uses `agent-browser` (the Bash CLI tool) for ALL browser
interaction. Do NOT use MCP browser tools (`mcp__dashboard-local__*`,
`mcp__dashboard-remote__*`). MCP tools are a completely separate browser
automation layer — they will open different browser instances, collide with
the agent-browser sessions, and break the comparison workflow. Every browser
command in this skill runs via `Bash(agent-browser ...)`. If you catch
yourself reaching for an MCP tool, stop and use the equivalent agent-browser
command instead.**

Uses two named agent-browser sessions (`--session local` and `--session remote`) for browser isolation.
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

Open both browser sessions in headed mode with persistent profiles (so auth survives reconnects):

```bash
agent-browser --session local --headed --profile .agent-browser/local open http://localhost:3001/signin
agent-browser --session remote --headed --profile .agent-browser/remote open https://<REMOTE_ENV>.8flow.com/signin
```

**Note:** `--headed` and `--profile` only take effect on the first command that
starts the daemon for a session. Subsequent commands for the same session
inherit these settings automatically — you only need `--session <name>`.

---

<!-- role: workflow -->

## Phase 1: Sign-in

Wait 3 seconds, then snapshot both browsers **in parallel** to check for
active sessions:

```bash
# Run these two in parallel (same message, two Bash tool calls)
agent-browser --session local snapshot
agent-browser --session remote snapshot
```

Check the snapshot output for signs of authentication:
- **Authenticated**: snapshot shows sidebar links (Insights, Users, Teams),
  a dashboard heading, or filter controls (Team, Timezone, etc.)
- **Not authenticated**: snapshot shows a sign-in form, email/password fields,
  or "Sign in" heading

If either browser shows the sign-in form, ask:

```
Question: Both sign-in pages are open in separate windows (local and remote). Please sign in to both, then click Continue.
Header: Sign-in confirmation
Options:
  - "Continue" -- I have signed in to both environments and am ready to compare screens
```

If both browsers are already authenticated (common when `--profile` is
reused), skip the question and proceed directly to Phase 2.

After confirming auth, snapshot again to determine the current page. If a
browser is on `about:blank` or an unexpected page, navigate it to
`/insights/realtime` to start the comparison.

---

<!-- role: workflow -->

## Phase 2: Autonomous comparison

Work through each dashboard page systematically. For each page:

1. **Navigate** both browsers to the same URL path (parallel Bash calls)
2. **Wait + verify** data loaded (use the "Data loading and status checks" eval pattern)
3. **Select team** using the appropriate Reusable command sequence (multi-select for most pages, single-select eval for Realtime)
4. **Align ALL filters** before comparing data (see Filter alignment below)
5. **Click Update/Refresh/Search** in both (parallel), wait for data
6. **Compare data** using eval snippets — result counts first, then row data
7. **Exercise** interactive elements per the page's test script (sorting, tabs, drill-downs)
8. **Document** findings in the session report

**Per-page checklist (quick reference):**

| Page | Team select | Submit button | Key interactions |
|------|------------|---------------|-----------------|
| Realtime | single-select (eval) | Refresh | Sort columns, hide toggle, timezone |
| User Productivity | multi-select (find) | Update | Sort columns, drill into user, By Date/Host tabs |
| Team Productivity | multi-select (find) | Update | Per Team/Project/BPO tabs, Report Level, Period |
| Systems | multi-select (find) | Update | Cards/Table toggle, drill into system card |
| Microworkflows | multi-select (find) | Update | Sort columns, drill into row |
| Relays | multi-select (find) | Update | Sort columns |
| Favorites | multi-select (find) | Update | Sort columns |
| Workstreams | user select (find) | Search | Analyzing by User/Workstream, sort, pagination |

### Browser command patterns

Navigate:
```bash
agent-browser --session local open http://localhost:3001/insights/realtime
agent-browser --session remote open https://<REMOTE_ENV>.8flow.com/insights/realtime
```

Snapshot (primary comparison tool):
```bash
agent-browser --session local snapshot
agent-browser --session remote snapshot
```

Click (refs use `@` prefix):
```bash
agent-browser --session local click @e5
agent-browser --session remote click @e5
```

Fill:
```bash
agent-browser --session local fill @e3 "value"
agent-browser --session remote fill @e3 "value"
```

Select:
```bash
agent-browser --session local select @e7 "option-value"
agent-browser --session remote select @e7 "option-value"
```

Find elements by role/testid (useful when you don't have a ref):
```bash
agent-browser --session local find role option click "Scaled Ops"
agent-browser --session local find testid filter-select-search-input fill "Scaled Ops"
```

Evaluate (JavaScript expressions):
```bash
agent-browser --session local eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
agent-browser --session remote eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
```

Check/uncheck:
```bash
agent-browser --session local check @e12
agent-browser --session local uncheck @e12
```

Get info:
```bash
agent-browser --session local get url
agent-browser --session local get text @e5
```

**`eval` vs `find`:** Use `eval` for DOM queries and JavaScript expressions.
Use `find` when you need to locate elements by role, testid, text, label,
or placeholder and perform an action. `find` is more robust than `eval` for
interacting with React components. For multi-step sequences, chain commands
with `&&` in a single Bash call.

**Important:** Ref IDs (e.g., `@e5`) are per-session and per-snapshot. Always take a
fresh snapshot of each browser before interacting, and use the refs from THAT snapshot.
The same element will likely have different ref IDs in local vs remote.

### Parallel execution (critical for speed)

**Always run local and remote commands in parallel** by issuing both Bash
tool calls in the same message. The two sessions are independent — there
is never a dependency between them. Every command pair in this skill
(navigate, click, eval, snapshot) should be two parallel Bash calls:

```
Bash: agent-browser --session local click @e10    ← parallel
Bash: agent-browser --session remote click @e7    ← parallel
```

This cuts session time roughly in half.

### Reusable command sequences

The patterns below are the reliable, tested sequences. Use them exactly.

**Select team on multi-select pages** (User Productivity, Team Productivity,
Systems, Microworkflows, Relays, Favorites, Workstreams):

Chain the full sequence in one Bash call per browser. Get the dropdown ref
from a snapshot first, then:

```bash
# LOCAL — one chained command (replace @e12 with actual dropdown ref)
agent-browser --session local click @e12 && sleep 1 && agent-browser --session local find testid filter-select-search-input fill "Scaled Ops" && sleep 1 && agent-browser --session local find role option click "Scaled Ops" && agent-browser --session local press Escape

# REMOTE — same chain (replace @e9 with actual dropdown ref)
agent-browser --session remote click @e9 && sleep 1 && agent-browser --session remote find testid filter-select-search-input fill "Scaled Ops" && sleep 1 && agent-browser --session remote find role option click "Scaled Ops" && agent-browser --session remote press Escape
```

**Select team on Realtime** (single-select, no search box):

Clicking the option ref directly does NOT reliably commit the selection.
Use eval to click the listbox option instead:

```bash
# LOCAL — open dropdown then eval-click (replace @e17 with actual ref)
agent-browser --session local click @e17 && sleep 1 && agent-browser --session local eval 'var opts = Array.from(document.querySelector("[role=listbox]").children); var opt = opts.find(e => e.textContent.trim() === "Scaled Ops"); if (opt) { opt.click(); "clicked"; } else { "not found"; }'
```

**Select timezone** (single-select on all pages):

```bash
# Open dropdown (replace @e21 with actual ref), then eval-click
agent-browser --session local click @e21 && sleep 1 && agent-browser --session local eval 'var opts = Array.from(document.querySelector("[role=listbox]").children); var opt = opts.find(e => e.textContent.includes("Coordinated Universal")); if (opt) { opt.click(); "clicked"; } else { "not found"; }'
```

**Select user on Workstreams** (multi-select user dropdown):

```bash
agent-browser --session local click @e12 && sleep 1 && agent-browser --session local find testid filter-select-search-input fill "ahuti" && sleep 2 && agent-browser --session local find role option click "ahuti.rastogi@airbnb.com" && agent-browser --session local press Escape
```

**Toggle checkbox** (e.g., "Hide users with no events"):

```bash
agent-browser --session local eval "document.querySelector('input[type=\"checkbox\"]')?.click(); 'toggled'"
```

### Data loading and status checks

After clicking Update/Refresh/Search, wait then verify data loaded:

```bash
sleep 5 && agent-browser --session local eval "document.querySelector('main')?.innerText.match(/Showing \\d+ to \\d+ of [\\d,]+ results/)?.[0] || document.querySelector('main')?.innerText.match(/\\d+ results/)?.[0] || document.querySelector('main')?.innerText.substring(0,200)"
```

If the result is `"Loading..."`, wait 5 more seconds and retry. Do not
proceed to data comparison until both browsers show a result count.

### Data comparison eval snippets

**Result count:**
```bash
agent-browser --session local eval "document.querySelector('main')?.innerText.match(/\\d+ results/)?.[0] || 'no count'"
```

**First N table rows (all columns):**
```bash
agent-browser --session local eval "JSON.stringify(Array.from(document.querySelectorAll('table tbody tr')).slice(0,10).map(r => Array.from(r.querySelectorAll('td')).map(c => c.textContent.trim()).join('|')))"
```

**First N rows with specific columns** (e.g., email + status + aux):
```bash
agent-browser --session local eval "JSON.stringify(Array.from(document.querySelectorAll('table tbody tr')).slice(0,10).map(r => { var c = Array.from(r.querySelectorAll('td')); return c[0]?.textContent.trim() + '|' + c[5]?.textContent.trim() + '|' + c[7]?.textContent.trim(); }))"
```

**Summary/filter text:**
```bash
agent-browser --session local eval "document.querySelector('main')?.innerText.substring(0,300)"
```

**Note on quoting:** Use double quotes for the outer Bash string and single
quotes inside the JS. Avoid single-quote Bash strings with embedded
single quotes — they cause `SyntaxError: Invalid or unexpected token`.

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

### Data comparison approach

**Do not read full accessibility snapshots into context for comparison.**
Instead, use `eval` to extract specific data from the DOM for targeted comparison.

**Comparing result counts:**
```bash
agent-browser --session local snapshot 2>&1 | grep "results"
agent-browser --session remote snapshot 2>&1 | grep "results"
```

**Comparing table data via eval:**
```bash
# Extract first N rows as JSON for comparison
agent-browser --session local eval 'JSON.stringify(Array.from(document.querySelectorAll("table tbody tr")).slice(0,10).map(r => Array.from(r.querySelectorAll("td")).map(c => c.textContent.trim()).join("|")))'
agent-browser --session remote eval 'JSON.stringify(Array.from(document.querySelectorAll("table tbody tr")).slice(0,10).map(r => Array.from(r.querySelectorAll("td")).map(c => c.textContent.trim()).join("|")))'
```

**Comparing summary text:**
```bash
agent-browser --session local eval 'document.querySelector("main")?.innerText.substring(0,500)'
agent-browser --session remote eval 'document.querySelector("main")?.innerText.substring(0,500)'
```

**Using `diff snapshot` for structural comparison:**
```bash
# agent-browser's built-in diff compares current vs last snapshot
agent-browser --session local diff snapshot
```

**Interpreting differences:**

- Same result count but different rows: sort tie-breaking (cosmetic, not a bug)
- Different result counts: filtering bug — investigate filter alignment
- Same rows but different values: data bug — check if values differ by a
  consistent ratio (date range off-by-one) or randomly (query logic bug)
- Missing elements or different structure: UI bug

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
agent-browser --session local close
agent-browser --session remote close
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
  (prod) also does NOT persist team selection. This is consistent behavior —
  note it once in the first page's report, do not re-report it.
- **Single-select dropdowns (team on Realtime, timezone everywhere)**:
  Clicking the option ref directly often fails to commit the selection.
  Always use the `eval` + `querySelector("[role=listbox]")` pattern
  from the Reusable command sequences section.
- **Multi-select dropdowns (team on all other pages, users on Workstreams)**:
  Use `find testid filter-select-search-input fill` to search, then
  `find role option click` to select. This is more reliable than
  snapshot → grep ref → click ref, because refs change between snapshots.
- **"Hide users with no events" toggle**: This is an `input[type="checkbox"]`,
  not a `role="switch"`. Use eval: `document.querySelector('input[type="checkbox"]')?.click()`.
- System cards use `cursor-pointer` class, not `role="button"` — use
  `eval` with `querySelectorAll('[class*="cursor-pointer"]')` to click.
- The Table radio in Systems is a `[role="radio"]` element — use `eval`
  with `querySelectorAll('[role="radio"]')` to click it.
- Filters collapse after clicking Update — click "Show Filters" to
  re-expand for filter changes.
- Default period: May differ by 1 day between local and remote (known
  date boundary bug class).
- **TanStack Table sort direction**: First click on a column header may
  produce different sort directions in local vs remote (ascending vs
  descending) due to `sortDescFirst` configuration. This is cosmetic —
  click again to align directions, then compare.
- **Console error checking**: When a page shows "Something went wrong",
  use `agent-browser --session <name> console` to read console logs and
  identify which BFF endpoint returned 500.
- **Data loading**: Some pages (especially Workstreams, Systems) take
  5-10 seconds to load. Always use the "Data loading and status checks"
  pattern and retry if the page still shows "Loading...".

---

<!-- role: reference -->

## Tool reference

**All browser interaction uses `agent-browser` via the Bash tool — never MCP.**
`agent-browser` is a CLI browser automation tool that manages named sessions,
persistent browser profiles, and accessibility snapshots via a daemon process.
It is invoked exclusively through `Bash(agent-browser ...)` tool calls.

| Action     | Local browser                        | Remote browser                        |
| ---------- | ------------------------------------ | ------------------------------------- |
| Navigate   | `agent-browser --session local open <url>` | `agent-browser --session remote open <url>` |
| Snapshot   | `agent-browser --session local snapshot`   | `agent-browser --session remote snapshot`   |
| Click      | `agent-browser --session local click @<ref>`| `agent-browser --session remote click @<ref>`|
| Fill       | `agent-browser --session local fill @<ref> "val"` | `agent-browser --session remote fill @<ref> "val"` |
| Select     | `agent-browser --session local select @<ref> "val"` | `agent-browser --session remote select @<ref> "val"` |
| Press key  | `agent-browser --session local press Escape`| `agent-browser --session remote press Escape`|
| Find+act   | `agent-browser --session local find role option click "text"` | `agent-browser --session remote find role option click "text"` |
| Evaluate   | `agent-browser --session local eval "..."`  | `agent-browser --session remote eval "..."`  |
| Check      | `agent-browser --session local check @<ref>` | `agent-browser --session remote check @<ref>` |
| Get info   | `agent-browser --session local get url`     | `agent-browser --session remote get url`     |
| Console    | `agent-browser --session local console`     | `agent-browser --session remote console`     |
| Close      | `agent-browser --session local close`       | `agent-browser --session remote close`       |

Both sessions support the full set of agent-browser commands. Use them freely
to interact with the app (click filters, fill forms, expand panels, etc.).

**These are ALL Bash commands.** Every browser action is a `Bash(agent-browser ...)`
tool call. There are no other browser tools involved. Do NOT use MCP tools.

---

<!-- role: avoid -->

## What NOT to do

- **NEVER navigate to `/users`, `/teams`, `/teams/[id]`, or `/settings/*`.**
  These are management pages where clicks can modify production data.
- **NEVER use MCP browser tools.** All browser interaction must go through
  `agent-browser` via the Bash tool. Do not use `mcp__dashboard-local__*`
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
- Do not read full accessibility snapshots into context for comparison — use
  `eval` to extract specific data (table rows, summary text, result counts)
  from the DOM instead.
