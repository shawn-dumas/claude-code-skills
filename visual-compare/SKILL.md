---
name: visual-compare
description: Side-by-side visual comparison of the local dev environment vs. a remote app environment. Autonomously navigates both browsers through every dashboard page, exercises all filters and interactions, and documents discrepancies in a session report.
context: fork
allowed-tools: Read, Write, Bash, Question, mcp_dashboard-local__*, mcp_dashboard-remote__*
argument-hint: <app|app-staging|app-development>
---

Compare the local development environment against a remote app environment side by side.
`$ARGUMENTS` is the remote environment name: one of `app`, `app-staging`, or `app-development`.

The local browser (`mcp_dashboard-local_*` tools) uses a separate Chrome profile from the
remote browser (`mcp_dashboard-remote_*` tools) so Firebase auth tokens do not collide.

---

<!-- role: workflow -->

## Phase 0: Setup

### Validate argument

If `$ARGUMENTS` is empty or not one of `app`, `app-staging`, `app-development`, ask:

```
Question: Which remote environment do you want to compare against?
Header: Remote environment
Options:
  - "app" -- Production: https://app.8flow.com
  - "app-staging" -- Staging: https://app-staging.8flow.com
  - "app-development" -- Development: https://app-development.8flow.com
```

Set `REMOTE_ENV` to the validated argument. Set `REMOTE_BASE` to `https://$REMOTE_ENV.8flow.com`.

### Create directories and session file

Determine the session timestamp:

```bash
date '+%Y-%m-%d-%H%M'
```

Create the screenshot directory and session docs file:

```bash
mkdir -p docs/compare-<timestamp>
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

Set `SCREENSHOT_DIR` to `docs/compare-<timestamp>` — all screenshots go in this directory.

---

<!-- role: workflow -->

## Phase 1: Sign-in

Navigate both browsers to the sign-in page:

- **Local**: `http://localhost:3001/signin`
- **Remote**: `https://<REMOTE_ENV>.8flow.com/signin`

Wait 3 seconds, then check if both browsers already have an active session
(the Chrome profiles may have persistent sessions). If either browser shows
the sign-in form rather than a dashboard page, ask:

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
2. **Wait** for content to load (use `wait_for` with specific text, not fixed delays)
3. **Align ALL filters** before comparing data (see Filter alignment below)
4. **Snapshot** both browsers (accessibility snapshot for data, screenshot for visuals)
5. **Compare** structure, data values, and behavior
6. **Exercise** every interactive element (see Interaction checklist below)
7. **Document** findings in the session report

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

### Data comparison methodology

When comparing data between local and remote:

- **Same-day data**: If both environments show the same date rows, compare
  values cell by cell. They should match exactly.
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

### Screenshot naming

All screenshots go in `SCREENSHOT_DIR` (the `docs/compare-<timestamp>/` directory).

| Item             | Convention                          | Example                                   |
| ---------------- | ----------------------------------- | ----------------------------------------- |
| Screenshot       | `<SCREENSHOT_DIR>/local-<slug>.png` | `docs/compare-2026-03-19-1749/local-realtime.png` |
| Slug             | lowercase, hyphens, no special chars | `realtime`, `user-productivity-by-date`   |

### Report format

For each comparison state tested, append to the session docs file:

```markdown
## <Page Name> — <description of state> — <HH:MM>

### Screenshots

- Local: `<SCREENSHOT_DIR>/local-<slug>.png`
- Remote: `<SCREENSHOT_DIR>/remote-<slug>.png`

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

Append a summary section to the docs file:

```markdown
## Session Summary

|                     |                     |
| ------------------- | ------------------- |
| Screens compared    | <N>                 |
| Total discrepancies | <N prod + N local>  |
| Session ended       | <HH:MM>             |

### All screenshots taken

<list each file, one per line, with local/remote pairs grouped>

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
Screenshots saved to: docs/compare-<timestamp>/

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
| Workstream Analysis | `/insights/workstream-analysis` |
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

## Dashboard-specific notes

### Realtime (`/insights/realtime`)

- **Filters**: Team (single-select), Timezone, Refresh button (60s cooldown)
- **Toggle**: "Hide users with no events" — test both on and off states
- **Interactions**: Select team → click Refresh to load data. Sort by every
  column. Change timezone and Refresh again.
- **Key comparisons**: Result count (may differ if toggle bug exists), row
  order under same sort, duration values (will differ by seconds — expected
  for realtime data), last event detail text wording.

### User Productivity (`/insights/user-productivity`)

- **Filters**: Teams (multi-select), Days Period, Timezone, Shift Length, Hours toggle
- **Action**: Select team → click Update. Filters collapse after Update;
  click "Show Filters" to re-expand.
- **Interactions**: Click user row to open drill-down. In drill-down:
  - Compare summary stats row at top (all 11 metrics)
  - Click "Productivity By Host" tab — compare all 3 sub-tables
    (Productive, Unproductive, Unclassified)
  - Click "Productivity By Date" tab — compare date table, TTM Breakdown,
    AUX Summary, and timeline chart
  - Click individual date rows — verify TTM and AUX values match for the
    same date
- **Key comparisons**: Default timezone (should be same in both),
  date range for same period setting (row count and date boundaries),
  per-day data for overlapping dates (should match exactly).

### Team Productivity (`/insights/team-productivity`)

- **Filters**: Teams (multi-select), Report Period (This Month / Last Month),
  Report Level (Week / Day), Timezone, Shift Length, Hours toggle
- **Action**: Select team → click Update
- **Interactions**: Try both Report Periods and both Report Levels. Switch
  teams. Change timezone. Change shift length. Click Per Team / Per Project /
  Per BPO tabs.
- **Key comparisons**: Week/day period boundaries (should be identical date
  ranges), head count, project count, aggregate hour values. For
  zero-headcount days, compare how AVG OCCUPANCY is displayed.
- **Multiple timezone test**: Test with at least 2 different timezones to
  verify period boundaries are consistent.

### Systems (`/insights/systems`)

- **Filters**: Analyzing by (Team / User), Teams (multi-select), Period
  (date range picker). No timezone filter on this page.
- **Action**: Select team → click Update
- **Views**: Cards (default) and Table — toggle via radio buttons. The Table
  radio is a `[role="radio"]` element, not a button — use `evaluate` with
  `querySelectorAll('[role="radio"]')` to click it if the ref doesn't work.
- **Sort**: Dropdown with options: System, Users, Workstreams, Active Time,
  Microworkflows. Sort direction toggle button (ascending/descending).
- **Interactions**: Switch Cards ↔ Table view. Try different sort options.
  Use the Search box. Click a system card to open detail view. Try
  "Analyzing by User" vs "Analyzing by Team". Change date period.
- **Summary bar**: Header shows Systems count, Users count, Workstreams
  count, and Microworkflows count. Compare all four.
- **Key comparisons**: Users and Microworkflows should match exactly (they
  are discrete event counts). Workstreams and Active Time may differ
  slightly if date boundary bugs exist. Check per-system cards/rows —
  systems with activity only during business hours may match exactly.
- **Drill-down hierarchy** (4 levels deep — test all):
  1. **Systems list** → click a system card/row
  2. **System detail**: summary row + "Pages in [System]" table → click a page row
  3. **Page detail**: summary row + 4 tabs (Into Page, Out of Page, Within Page, By User).
     Transition tabs show ACTIVITY TYPE, SOURCE SYSTEM, SOURCE PAGE, SOURCE LABEL,
     TARGET LABEL, OCCURRENCES, WORKSTREAMS, USERS, AVG TIME SPENT PER WS,
     AVG DURATION, TOTAL DURATION. By User shows USER EMAIL, NAME, OCCURRENCES,
     WORKSTREAMS, ACTIVE TIME. Click all 4 tabs. User rows are clickable.
  4. **User within page** (deepest level) — click a user row from By User tab
- At each level compare: summary stats, table columns, row count, sort order,
  "Change System"/"Change Page"/"Change User" buttons, filter/export buttons.
- System cards use `cursor-pointer` class, not `role="button"` — use
  `evaluate` with `querySelectorAll('[class*="cursor-pointer"]')` to click
  if ref-based click fails.
- **State persistence**: Remote may persist team selection across page
  reloads; local may not. Note this if it occurs.
- **Default period**: May differ by 1 day between local and remote (same
  date boundary bug class as other pages).

---

<!-- role: reference -->

## Tool reference

| Action                 | Local browser                                  | Remote browser                                  |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Navigate               | `mcp_dashboard-local_browser_navigate`         | `mcp_dashboard-remote_browser_navigate`         |
| Screenshot             | `mcp_dashboard-local_browser_take_screenshot`  | `mcp_dashboard-remote_browser_take_screenshot`  |
| Accessibility snapshot | `mcp_dashboard-local_browser_snapshot`         | `mcp_dashboard-remote_browser_snapshot`         |
| Network requests       | `mcp_dashboard-local_browser_network_requests` | `mcp_dashboard-remote_browser_network_requests` |
| Wait                   | `mcp_dashboard-local_browser_wait_for`         | `mcp_dashboard-remote_browser_wait_for`         |
| Click                  | `mcp_dashboard-local_browser_click`            | `mcp_dashboard-remote_browser_click`            |
| Fill form              | `mcp_dashboard-local_browser_fill_form`        | `mcp_dashboard-remote_browser_fill_form`        |
| Type                   | `mcp_dashboard-local_browser_type`             | `mcp_dashboard-remote_browser_type`             |

Both browsers support the full set of Playwright MCP tools. Use them freely
to interact with the app (click filters, fill forms, expand panels, etc.).

---

<!-- role: avoid -->

## What NOT to do

- Do not use a single browser for both environments — Firebase auth tokens will collide across sessions.
- Do not compare data before aligning ALL filters — timezone, team, period,
  shift length, etc. must all match. Prod is the source of truth for defaults.
- Do not stop to ask the user questions during the comparison — work
  autonomously through all pages and interactions. Only ask if you encounter
  a blocker (e.g., page crashes, auth expires).
- Do not report data differences without first checking whether the
  difference traces to a known bug (like date boundary differences). Always
  drill down to confirm root cause.
- Do not take screenshots before navigation has settled — always wait for
  content to appear.
- Do not append to a prior session's docs file — each invocation creates a new timestamped file.
- Do not include static resource requests (images, fonts, JS bundles) in the API request tables — set `includeStatic: false`.
- Do NOT CHANGE ANY DATA (do NOT manipulate users, teams, or URL classifications).
- Do not guess URL paths — use the route map. If a path 404s, check the
  route map before asking the user.
