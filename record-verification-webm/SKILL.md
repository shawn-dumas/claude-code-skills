---
name: record-verification-webm
description: Record a verification WebM video of a bug fix by driving the browser through a scripted sequence using playwright-cli with native video recording. Optionally attaches the video to a Jira ticket.
allowed-tools: Bash(playwright-cli:*), Bash(curl:*), Bash(which:*), Bash(brew:*), Bash(ls:*), Bash(mkdir:*), Bash(mv:*), Bash(cp:*), Bash(docker:*), Bash(sleep:*), mcp__atlassian__jira_update_issue, Read
argument-hint: <ticket-id-or-description> [--attach <JIRA-KEY>] [--output <path>]
---

# Record Verification WebM

Record a WebM video that demonstrates a bug fix by driving the browser
through a scripted sequence using `playwright-cli` with native video
recording.

`$ARGUMENTS` contains the ticket ID or a short description of what to
demonstrate, plus optional flags:

- `--attach AV-1234` -- attach the video to the specified Jira ticket
- `--output ~/Desktop/demo.webm` -- output path (default: `~/Desktop/<ticket-or-description>.webm`)

---

<!-- role: workflow -->

## Phase 0: Prerequisites

### Check playwright-cli

```bash
which playwright-cli
```

If not installed:

```bash
npm install -g @playwright/cli
```

### Check dev server

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
```

If 000 or connection refused, tell the user to start the dev server
(`pnpm dev`) and wait.

---

<!-- role: workflow -->

## Phase 1: Plan the sequence

Based on `$ARGUMENTS`, plan a sequence of 3-10 actions that demonstrates
the fix. Each action maps to a `playwright-cli` command:

| Action | Command |
|--------|---------|
| Navigate to URL | `playwright-cli goto <url>` |
| Resize viewport | `playwright-cli resize <w> <h>` |
| Click element | `playwright-cli click <ref>` |
| Type text | `playwright-cli type <text>` |
| Fill field | `playwright-cli fill <ref> <text>` |
| Press key | `playwright-cli press <key>` |
| Wait for settle | `playwright-cli run-code "async page => { await page.waitForTimeout(500); }"` |
| Get element refs | `playwright-cli snapshot` |

Tell the user the planned sequence before executing. If the user has
already described the steps, skip confirmation and proceed.

---

<!-- role: workflow -->

## Phase 2: Open browser and authenticate

### Open browser

```bash
playwright-cli open http://localhost:3001
```

### Authenticate

Take a snapshot to check if the page landed on `/signin`:

```bash
playwright-cli snapshot
```

If on the sign-in page, authenticate via the dev helper. Use `run-code`
(not `eval`) because `__devSignInWithUid` is async:

```bash
playwright-cli run-code "async page => { await page.evaluate(() => window.__devSignInWithUid('<uid>')); }"
```

To find a valid UID, query local Postgres:

```bash
docker exec user-frontend-postgres-1 psql -U postgres -d user_mgmt -t -c \
  "SELECT uid FROM customer_user WHERE active = true LIMIT 1;"
```

After sign-in, navigate to the target page.

---

<!-- role: workflow -->

## Phase 3: Record

### Start recording

```bash
playwright-cli video-start
```

### Execute the planned sequence

Run each step from Phase 1 as individual `playwright-cli` commands.

Between steps that involve visual transitions (resizes, page loads,
animations), add a brief pause so the recording captures the change:

```bash
playwright-cli run-code "async page => { await page.waitForTimeout(500); }"
```

**Important:** `playwright-cli eval` cannot return promises -- it
evaluates synchronously. Use `run-code` for any async operations
including `setTimeout` and `waitForTimeout`.

For smooth viewport resizes, step in increments rather than jumping:

```bash
playwright-cli resize 1280 800
playwright-cli run-code "async page => { await page.waitForTimeout(300); }"
playwright-cli resize 1200 800
playwright-cli run-code "async page => { await page.waitForTimeout(300); }"
playwright-cli resize 1100 800
# ... continue stepping down
```

Use `playwright-cli snapshot` as needed to discover element refs for
clicks and interactions.

### Stop recording and save

`video-stop` accepts an optional output path. Pass the desired path
directly to avoid an extra copy step.

```bash
playwright-cli video-stop <OUTPUT_PATH>
```

Default output is `~/Desktop/<ticket-or-description>.webm`.

### Verify

```bash
ls -lh <OUTPUT_PATH>
```

Report the file size and output path to the user.

---

<!-- role: workflow -->

## Phase 4: Cleanup

```bash
playwright-cli close
```

---

<!-- role: workflow -->

## Phase 5: Attach to Jira (optional)

If `--attach <JIRA-KEY>` was specified:

```
mcp__atlassian__jira_update_issue(
  issue_key: "<JIRA-KEY>",
  fields: "{}",
  attachments: "<OUTPUT_PATH>"
)
```

Report success or failure.

---

<!-- role: conventions -->

## Conventions

- Use `playwright-cli snapshot` to discover element refs before clicking.
  Refs change after page mutations -- re-snapshot if needed.
- Add 200-500ms pauses between visual transitions so the recording
  captures the change. Without pauses, fast CLI commands execute faster
  than the frame rate can capture.
- For viewport resizes, step in 50-100px increments for smooth motion.
  A single jump from 1280 to 768 looks jarring in the recording.
- If the WebM exceeds 5MB, note it to the user -- they may want a
  shorter sequence or the GIF skill instead.
- Never commit the video to the repo. It goes to Desktop or gets
  attached to Jira.
- Always close the browser at the end.
