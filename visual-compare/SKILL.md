---
name: visual-compare
description: Side-by-side visual comparison of the local dev environment vs. a remote app environment. Autonomously navigates both browsers through every dashboard page, exercises all filters and interactions, and documents discrepancies in a session report.
context: fork
allowed-tools: Bash(playwright-cli:*), Read, Write, Bash(date:*), Bash(mkdir:*), Bash(sed:*), Bash(diff:*), Bash(cat:*)
argument-hint: <app|app-staging|app-development>
---

Compare the local development environment against a remote app environment side by side.
`$ARGUMENTS` is the remote environment name: one of `app`, `app-staging`, or `app-development`.

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

Evaluate (for elements that need DOM queries):
```bash
playwright-cli -s=local eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
playwright-cli -s=remote eval "document.querySelectorAll('[role=\"radio\"]')[1].click()"
```

**Important:** Ref IDs (e.g., `e5`) are per-session and per-snapshot. Always take a
fresh snapshot of each browser before interacting, and use the refs from THAT snapshot.
The same element will likely have different ref IDs in local vs remote.

### Filter alignment protocol

**Before comparing ANY data, all filters must be identical in both browsers.**

1. After loading a page, snapshot both browsers to read the current filter state
2. If any filter defaults differ (e.g., timezone), change the LOCAL browser to
   match the REMOTE browser's defaults — prod is the source of truth
3. Note any default differences as findings (these are local BFF bugs)
4. Only after all filters match, click Update/Refresh to load data
5. When testing a filter change, change the SAME filter to the SAME value in
   both browsers simultaneously, then Update both

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

**Never read both full YAML snapshots into context.** Instead, normalize
and diff them. This catches everything — missing elements, different
labels, extra buttons, wrong data values — not just table content.

After snapshotting both browsers, run:

```bash
# Get the snapshot file paths from the playwright-cli output
LOCAL_SNAP=".playwright-cli/<local-snapshot>.yml"
REMOTE_SNAP=".playwright-cli/<remote-snapshot>.yml"

# Normalize: strip ref IDs, cursor attributes, and dev-only elements
sed -E \
  -e 's/\[ref=e[0-9]+\]//g' \
  -e 's/ \[cursor=pointer\]//g' \
  -e '/Open Tanstack query devtools/d' \
  -e '/Open Next.js Dev Tools/d' \
  -e '/Notifications alt\+T/d' \
  "$LOCAL_SNAP" > /tmp/vc-local.yml

sed -E \
  -e 's/\[ref=e[0-9]+\]//g' \
  -e 's/ \[cursor=pointer\]//g' \
  -e '/Open Tanstack query devtools/d' \
  -e '/Open Next.js Dev Tools/d' \
  -e '/Notifications alt\+T/d' \
  "$REMOTE_SNAP" > /tmp/vc-remote.yml

# Diff — empty output means identical
diff /tmp/vc-local.yml /tmp/vc-remote.yml
```

**Interpreting the diff:**

- Lines only in local (`<`): elements or data the BFF produces that prod
  does not — may be a local bug or a new feature not yet in prod.
- Lines only in remote (`>`): elements or data prod has that local lacks
  — likely a local BFF bug or missing feature.
- Changed lines: same element with different content — compare the values.
  For tables, this surfaces cell-by-cell differences directly.

**Expected diff noise** (ignore these):

- `[active]` attribute (which element has focus differs between sessions)
- `[expanded]` / `[disabled]` on the Refresh button (cooldown timer state)
- Duration values on the Realtime page (tick every second)
- `alert` element content differences
- `[selected]` on tabs (if you clicked different tabs)
- Pagination button state (`[disabled]` on first/last page)
- Open tab lists (remote may have extra browser tabs)

**For Realtime specifically**, also strip ticking durations before diffing:

```bash
# Additional normalization for Realtime — strip duration values
sed -E 's/[0-9]+h [0-9]+min [0-9]+sec/Xh Xmin Xsec/g; s/[0-9]+min [0-9]+sec/Xmin Xsec/g; s/[0-9]+sec/Xsec/g' \
  /tmp/vc-local.yml > /tmp/vc-local-rt.yml
sed -E 's/[0-9]+h [0-9]+min [0-9]+sec/Xh Xmin Xsec/g; s/[0-9]+min [0-9]+sec/Xmin Xsec/g; s/[0-9]+sec/Xsec/g' \
  /tmp/vc-remote.yml > /tmp/vc-remote-rt.yml
diff /tmp/vc-local-rt.yml /tmp/vc-remote-rt.yml
```

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
| Microworkflows      | `/insights/microworkflows`      |
| Workstreams          | `/insights/workstreams`         |
| Relays              | `/insights/relays`              |
| Favorites           | `/insights/favorites`           |
| Chat                | `/insights/chat`                |
| User Detail         | `/insights/details`             |
| Users               | `/users`                        |
| Teams               | `/teams`                        |
| Team Detail         | `/teams/[id]`                   |
| Settings: Account   | `/settings/account`             |
| Settings: BPOs      | `/settings/bpos`                |
| Settings: Projects  | `/settings/projects`            |
| Settings: URLs      | `/settings/urls`                |

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

### Workstreams (`/insights/workstreams`)

1. This page loads without requiring a team filter — it shows all
   workstream definitions. Wait for load.
2. **Diff default state**: diff catches row count, column headers,
   and all row content differences. Document.
3. **Sort by each sortable column**: click headers in both, diff
   after each. At minimum: WORKSTREAM NAME, ACTIVE TIME, USERS.
4. **Search**: type the same search term in both search boxes. Diff
   filtered results. Document.

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

### Users (`/users`)

1. Page loads automatically with user list.
2. **Diff default state**: diff catches row count, column headers,
   and all user rows. Document.
3. **Sort by NAME**: click header in both. Diff.
4. **Sort by EMAIL**: click header in both. Diff.
5. **Search**: type the same user name in both search boxes. Diff
   filtered results. Document.
6. **Click a user row**: diff the user detail/edit view. Verify
   all fields match. Document.
7. **Close** the detail view without making changes.

### Teams (`/teams`)

1. Page loads with team list.
2. **Diff default state**: diff catches row count, columns, and all
   team rows. Document.
3. **Sort by team name**: click header in both. Diff.
4. **Click a team row**: navigate to team detail (`/teams/[id]`).
   Diff — verify member list, team metadata. Document.
5. **Navigate back** to teams list.

### Settings pages (`/settings/account`, `/settings/bpos`, `/settings/projects`, `/settings/urls`)

For each settings page:

1. Navigate both browsers to the page.
2. **Diff**: catches all form field, label, and value differences.
   Document.
3. **Do NOT modify** any settings — read-only comparison.

### Implementation notes

- System cards use `cursor-pointer` class, not `role="button"` — use
  `eval` with `querySelectorAll('[class*="cursor-pointer"]')` to click
  if ref-based click fails.
- The Table radio in Systems is a `[role="radio"]` element — use `eval`
  with `querySelectorAll('[role="radio"]')` to click it if needed.
- Filters collapse after clicking Update on User Productivity — click
  "Show Filters" to re-expand for filter changes.
- State persistence: Remote may persist team selection across page
  reloads; local may not. Note this if it occurs.
- Default period: May differ by 1 day between local and remote (known
  date boundary bug class).

---

<!-- role: reference -->

## Tool reference

All browser interaction uses `playwright-cli` with named sessions:

| Action     | Local browser                        | Remote browser                        |
| ---------- | ------------------------------------ | ------------------------------------- |
| Navigate   | `playwright-cli -s=local goto <url>` | `playwright-cli -s=remote goto <url>` |
| Snapshot   | `playwright-cli -s=local snapshot`   | `playwright-cli -s=remote snapshot`   |
| Click      | `playwright-cli -s=local click <ref>`| `playwright-cli -s=remote click <ref>`|
| Fill       | `playwright-cli -s=local fill <ref> "val"` | `playwright-cli -s=remote fill <ref> "val"` |
| Select     | `playwright-cli -s=local select <ref> "val"` | `playwright-cli -s=remote select <ref> "val"` |
| Type       | `playwright-cli -s=local type "text"`| `playwright-cli -s=remote type "text"`|
| Evaluate   | `playwright-cli -s=local eval "..."`  | `playwright-cli -s=remote eval "..."`  |
| Close      | `playwright-cli -s=local close`      | `playwright-cli -s=remote close`      |

Both sessions support the full set of playwright-cli commands. Use them freely
to interact with the app (click filters, fill forms, expand panels, etc.).

---

<!-- role: avoid -->

## What NOT to do

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
