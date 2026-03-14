---
name: visual-compare
description: Side-by-side visual comparison of the local dev environment vs. a remote app environment. Opens both in separate Chrome profiles, waits for login, then navigates per user instructions — taking screenshots, capturing network traffic, and documenting discrepancies in a session report.
context: fork
allowed-tools: Read, Write, Bash, Question, mcp_dashboard-local__*, mcp_dashboard-remote__*
argument-hint: <app|app-staging|app-development>
---

Compare the local development environment against a remote app environment side by side.
`$ARGUMENTS` is the remote environment name: one of `app`, `app-staging`, or `app-development`.

The local browser (`mcp_dashboard-local_*` tools) uses a separate Chrome profile from the
remote browser (`mcp_dashboard-remote_*` tools) so Firebase auth tokens do not collide.

---

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

```bash
mkdir -p screenshots
```

Determine the session timestamp:

```bash
date '+%Y-%m-%d-%H%M'
```

Create the session docs file at `docs/compare-<timestamp>.md` with this header:

```markdown
# Visual Comparison: <REMOTE_ENV> — <YYYY-MM-DD HH:MM>

| | Local | Remote |
|---|---|---|
| Base URL | http://localhost:3001 | https://<REMOTE_ENV>.8flow.com |
| Environment | local | <REMOTE_ENV> |
| Session started | <YYYY-MM-DD HH:MM> | |

---
```

Record the docs file path — you will append to it throughout the session.

---

## Phase 1: Open sign-in pages

Open the sign-in page in each browser simultaneously:

- **Local** (`mcp_dashboard-local_browser_navigate`): navigate to `http://localhost:3001/signin`
- **Remote** (`mcp_dashboard-remote_browser_navigate`): navigate to `https://<REMOTE_ENV>.8flow.com/signin`

Take initial screenshots of both:

- `mcp_dashboard-local_browser_take_screenshot` → save as `screenshots/local-signin.png`
- `mcp_dashboard-remote_browser_take_screenshot` → save as `screenshots/remote-signin.png`

Append to the docs file:

```markdown
## Sign-in — <timestamp>

### Screenshots
- Local: `screenshots/local-signin.png`
- Remote: `screenshots/remote-signin.png`

---
```

Then pause and ask the user to sign in:

```
Question: Both sign-in pages are open in separate windows (local and remote). Please sign in to both, then click Continue.
Header: Sign-in confirmation
Options:
  - "Continue" -- I have signed in to both environments and am ready to compare screens
```

---

Don't take any screenshots until after signin is completed.

## Phase 2: Comparison loop

Repeat the following until the user selects "Done".

### Step 2a: Ask which screen to navigate to

```
Question: Which screen do you want to compare next?
Header: Next screen
Options:
  - "Done — finish session" -- End the session and write the summary
```

Also allow free-text input for any screen name or path (e.g., "Dashboard", "/insights/productivity", "Team Settings").

If the user selects "Done — finish session", skip to Phase 3.

### Step 2b: Navigate both browsers

Derive a URL path from the user's input:
- If it starts with `/`, use it directly as the path.
- Otherwise, treat it as a screen name and navigate to the closest matching path (use your knowledge of the app's route structure). If uncertain, ask: "What is the URL path for <screen>? (e.g. /dashboard)"

Derive a slug for file naming: lowercase, spaces replaced with hyphens, special characters removed.
Example: "Team Settings" → `team-settings`, "/insights/productivity" → `insights-productivity`.

Navigate both browsers:

- `mcp_dashboard-local_browser_navigate` → `http://localhost:3001<path>`
- `mcp_dashboard-remote_browser_navigate` → `https://<REMOTE_ENV>.8flow.com<path>`

Wait for content to load in both:

- `mcp_dashboard-local_browser_wait_for` with `time: 2` (or wait for a known heading/element if one is predictable)
- `mcp_dashboard-remote_browser_wait_for` with `time: 2`

### Step 2c: Take screenshots

- `mcp_dashboard-local_browser_take_screenshot` → `screenshots/local-<slug>.png`
- `mcp_dashboard-remote_browser_take_screenshot` → `screenshots/remote-<slug>.png`

### Step 2d: Capture accessibility snapshots

Take accessibility snapshots from both browsers for structural comparison:

- `mcp_dashboard-local_browser_snapshot`
- `mcp_dashboard-remote_browser_snapshot`

Compare the two snapshots. Look for:
- **Structural differences**: elements present in one but absent in the other (buttons, panels, table columns, navigation items)
- **Text/data differences**: same element with different text content, different counts, different labels
- **State differences**: loading states, empty states, error states in one but not the other
- **ARIA differences**: different roles, labels, or descriptions for equivalent elements

### Step 2e: Capture network requests

Capture API requests from both browsers:

- `mcp_dashboard-local_browser_network_requests` with `includeStatic: false`
- `mcp_dashboard-remote_browser_network_requests` with `includeStatic: false`

For each browser's request list:
- Filter to requests whose URL contains `/api/`
- Record: HTTP method, path (strip base URL), status code, and a brief response summary (record count if JSON array, key fields if JSON object, or status if non-200)

### Step 2f: Append section to docs file

Append the following to `docs/compare-<timestamp>.md`:

```markdown
## <Screen Name> — <HH:MM>

### Screenshots
- Local: `screenshots/local-<slug>.png`
- Remote: `screenshots/remote-<slug>.png`

### Visual discrepancies
<List each discrepancy observed from comparing snapshots and screenshots, or "None observed">

### Data discrepancies
<List any differences in displayed values, counts, or data between the two environments, or "None observed">

### API Requests — Local
| Method | Path | Status | Summary |
|--------|------|--------|---------|
| GET | /api/example | 200 | 42 records |

### API Requests — Remote
| Method | Path | Status | Summary |
|--------|------|--------|---------|
| GET | /api/example | 200 | 38 records |

---
```

Fill in the actual data from Steps 2d and 2e. If a request appears in one browser but not the other, note it explicitly under "Data discrepancies".

Return to Step 2a.

---

## Phase 3: Session wrap-up

Append a summary section to the docs file:

```markdown
## Session Summary

| | |
|---|---|
| Screens compared | <N> |
| Total discrepancies | <N visual + N data> |
| Session ended | <HH:MM> |

### All screenshots taken
<list each file, one per line, with local/remote pairs grouped>

### Discrepancy index
<bulleted list of every discrepancy found across all screens, referencing the screen section where it was recorded. If none, write "No discrepancies found.">
```

Output to the user:

```
Session complete. Report saved to: docs/compare-<timestamp>.md
Screenshots saved to: screenshots/

Screens compared: <N>
Discrepancies found: <N>
```

---

## Naming conventions

| Item | Convention | Example |
|------|-----------|---------|
| Session docs file | `docs/compare-<YYYY-MM-DD-HHmm>.md` | `docs/compare-2026-03-13-1432.md` |
| Local screenshot | `screenshots/local-<slug>.png` | `screenshots/local-dashboard.png` |
| Remote screenshot | `screenshots/remote-<slug>.png` | `screenshots/remote-dashboard.png` |
| Slug | lowercase, hyphens, no special chars | `team-settings`, `insights-productivity` |
| Sign-in screenshots | `local-signin.png` / `remote-signin.png` | (fixed names, taken at session start) |

---

## Tool reference

| Action | Local browser | Remote browser |
|--------|--------------|----------------|
| Navigate | `mcp_dashboard-local_browser_navigate` | `mcp_dashboard-remote_browser_navigate` |
| Screenshot | `mcp_dashboard-local_browser_take_screenshot` | `mcp_dashboard-remote_browser_take_screenshot` |
| Accessibility snapshot | `mcp_dashboard-local_browser_snapshot` | `mcp_dashboard-remote_browser_snapshot` |
| Network requests | `mcp_dashboard-local_browser_network_requests` | `mcp_dashboard-remote_browser_network_requests` |
| Wait | `mcp_dashboard-local_browser_wait_for` | `mcp_dashboard-remote_browser_wait_for` |
| Click | `mcp_dashboard-local_browser_click` | `mcp_dashboard-remote_browser_click` |
| Type | `mcp_dashboard-local_browser_type` | `mcp_dashboard-remote_browser_type` |

Both browsers support the full set of Playwright MCP tools. Use them freely when
the user asks you to interact with the app (e.g., click a filter, fill a form,
expand a panel) before taking a comparison screenshot.

---

## What NOT to do

- Do not use a single browser for both environments — Firebase auth tokens will collide across sessions.
- Do not guess the user is logged in — always wait for explicit confirmation via the Question tool after opening sign-in pages.
- Do not use fixed time waits as the primary wait strategy — prefer waiting for specific text or elements; use `time: 2` only as a fallback when no reliable signal exists.
- Do not take screenshots before navigation has settled — always wait after navigating.
- Do not append to a prior session's docs file — each invocation creates a new timestamped file.
- Do not include static resource requests (images, fonts, JS bundles) in the API request tables — set `includeStatic: false`.
