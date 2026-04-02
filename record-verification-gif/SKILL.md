---
name: record-verification-gif
description: Record a verification GIF of a bug fix by driving the browser through a sequence of steps, capturing screenshots at each step, and stitching them into an animated GIF. Optionally attaches the GIF to a Jira ticket.
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_resize, mcp__playwright__browser_click, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_press_key, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_fill_form, mcp__playwright__browser_install, mcp__playwright__browser_run_code, mcp__playwright__browser_close, mcp__atlassian__jira_update_issue, mcp__atlassian__jira_add_comment, Bash(ffmpeg:*), Bash(mkdir:*), Bash(ls:*), Bash(rm:*), Bash(cp:*), Bash(curl:*), Bash(which:*), Bash(brew:*), Read
argument-hint: <ticket-id-or-description> [--attach <JIRA-KEY>] [--output <path>]
---

# Record Verification GIF

Record an animated GIF that demonstrates a bug fix by driving the browser
through a scripted sequence, capturing screenshots at each step, and
stitching the frames into a looping GIF.

`$ARGUMENTS` contains the ticket ID or a short description of what to
demonstrate, plus optional flags:

- `--attach AV-1234` -- attach the GIF to the specified Jira ticket
- `--output ~/Desktop/demo.gif` -- output path (default: `~/Desktop/<ticket-or-description>.gif`)

---

<!-- role: workflow -->

## Phase 0: Prerequisites

### Check ffmpeg

```bash
which ffmpeg
```

If ffmpeg is not installed:

```bash
brew install ffmpeg
```

### Check browser

Attempt a Playwright MCP navigation. If the browser fails to launch:

1. Remove stale user data: `rm -rf ~/Library/Caches/ms-playwright/mcp-chrome-*`
2. Call `mcp__playwright__browser_install`
3. Retry navigation

### Check dev server

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
```

If 000 or connection refused, start the dev server:

```bash
pnpm dev &
```

Wait up to 15 seconds, polling with `curl` until the server responds 200.

### Authenticate

If the page redirects to `/signin`, authenticate via the dev helper:

```javascript
await window.__devSignInWithUid('<uid>');
```

To find a valid UID, query the local Postgres:

```bash
docker exec user-frontend-postgres-1 psql -U postgres -d user_mgmt -t -c \
  "SELECT uid FROM customer_user WHERE active = true LIMIT 1;"
```

---

<!-- role: workflow -->

## Phase 1: Plan the sequence

Based on `$ARGUMENTS`, plan a sequence of actions that demonstrates the fix.
The sequence should include smooth transitions where applicable (e.g.,
viewport resizing in small increments rather than a single jump).

**Smooth motion guidelines:**

- Viewport resizes: step in 30-50px increments between start and end widths
- Hold frames: add 3-5 duplicate frames at key states so the viewer can read them
- Interactions: add a brief `waitForTimeout(300)` after clicks for animations to settle
- Target 30-50 total frames for a 4-6 second GIF at 8fps

Tell the user the planned sequence before executing. If the user has
already described the steps, skip confirmation and proceed.

---

<!-- role: workflow -->

## Phase 2: Capture frames

### Create temp directory

```bash
mkdir -p /tmp/verification-gif-frames
rm -f /tmp/verification-gif-frames/*.png
```

### Batch capture with `browser_run_code`

**Always use `mcp__playwright__browser_run_code` for frame capture.** This
executes the entire sequence in a single Playwright call, avoiding 30-50
individual MCP round-trips. Individual MCP screenshot calls are too slow
for smooth GIFs.

Write a single async function that:

1. Defines a `snap()` helper that calls `page.screenshot()` with
   zero-padded filenames (`/tmp/verification-gif-frames/frame01.png`, etc.)
2. Loops through viewport sizes, clicks, and waits
3. Calls `snap()` at each step

**Example** (responsive sidebar demo):

```javascript
async (page) => {
  const dir = '/tmp/verification-gif-frames';
  let n = 1;
  const pad = i => String(i).padStart(2, '0');

  async function snap() {
    await page.screenshot({
      path: `${dir}/frame${pad(n)}.png`,
      type: 'png',
      scale: 'css',
    });
    n++;
  }

  // Hold at desktop
  await page.setViewportSize({ width: 1280, height: 800 });
  for (let i = 0; i < 3; i++) await snap();

  // Smooth shrink to mobile
  for (let w = 1240; w >= 768; w -= 40) {
    await page.setViewportSize({ width: w, height: 800 });
    await snap();
  }

  // Hold at mobile
  for (let i = 0; i < 4; i++) await snap();

  // Interact
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 5; i++) await snap();

  return `Captured ${n - 1} frames`;
}
```

**Key patterns:**

| Pattern | Code |
|---------|------|
| Hold at a state | `for (let i = 0; i < N; i++) await snap();` |
| Smooth resize | `for (let w = start; w >= end; w -= step) { await page.setViewportSize({...}); await snap(); }` |
| Click + settle | `await page.getByRole(...).click(); await page.waitForTimeout(300);` |
| Wait for text gone | `await page.getByText('Loading...').first().waitFor({ state: 'hidden' });` |
| Find element ref | Use `mcp__playwright__browser_snapshot` BEFORE the run_code call to discover selectors |

**Note:** `require()` is not available in `browser_run_code`. Use only
Playwright's `page` API. File I/O works through `page.screenshot()` which
writes directly to disk.

---

<!-- role: workflow -->

## Phase 3: Stitch into GIF

### Normalize frame dimensions

Screenshots may have different dimensions (e.g., desktop vs mobile).
Detect the maximum width and height across all frames:

```bash
MAX_W=0; MAX_H=0
for f in /tmp/verification-gif-frames/frame*.png; do
  dims=$(ffmpeg -i "$f" -hide_banner 2>&1 | grep -o '[0-9]\+x[0-9]\+' | head -1)
  w=${dims%x*}; h=${dims#*x}
  [ "$w" -gt "$MAX_W" ] && MAX_W=$w
  [ "$h" -gt "$MAX_H" ] && MAX_H=$h
done
echo "${MAX_W}x${MAX_H}"
```

Pad all frames to the maximum dimensions with a white background:

```bash
for f in /tmp/verification-gif-frames/frame*.png; do
  ffmpeg -y -i "$f" \
    -vf "scale=<MAX_W>:<MAX_H>:force_original_aspect_ratio=decrease,pad=<MAX_W>:<MAX_H>:(ow-iw)/2:(oh-ih)/2:color=white" \
    "${f%.png}_pad.png" 2>/dev/null
done
```

### Generate GIF

```bash
ffmpeg -y -start_number 1 -framerate 12 \
  -i /tmp/verification-gif-frames/frame%02d_pad.png \
  -vf "scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  -loop 0 <OUTPUT_PATH>
```

**Always use 12fps.** Adjust frame count to control duration (e.g., 36
frames = 3s, 48 frames = 4s, 60 frames = 5s). Add hold frames to
lengthen pauses at key states rather than dropping the framerate.

Default output is `~/Desktop/<ticket-or-description>.gif`.

### Verify

```bash
ls -lh <OUTPUT_PATH>
```

Report the frame count, file size, duration, and output path to the user.

---

<!-- role: workflow -->

## Phase 4: Attach to Jira (optional)

If `--attach <JIRA-KEY>` was specified, this is a two-step process:
first upload the file, then add a comment that references it.

### Step 1: Upload the attachment

```
mcp__atlassian__jira_update_issue(
  issue_key: "<JIRA-KEY>",
  fields: "{}",
  attachments: "<OUTPUT_PATH>"
)
```

### Step 2: Add a comment with context

```
mcp__atlassian__jira_add_comment(
  issue_key: "<JIRA-KEY>",
  body: "**Verification (<environment>):** see attached `<filename>`

Recorded against <URL> (<version>, <commit>). The GIF walks through the reproduction steps:

<numbered list of what happens in the GIF>

**What:** <one-line description of the fix>

**Where:** <what was broken and in which file/module>

**Why:** <root cause explanation>"
)
```

The comment must reference the attached filename so readers can find
it. The what/where/why section gives context without requiring the
reader to find the PR.

---

<!-- role: conventions -->

## Conventions

- Frame filenames are always `frame<NN>.png` (zero-padded two digits).
- Always use `mcp__playwright__browser_run_code` for batch capture. Never
  loop over individual MCP screenshot calls -- a 42-frame sequence would
  require 42 round-trips and take minutes instead of seconds.
- Use `mcp__playwright__browser_snapshot` before the run_code call to
  discover element selectors, roles, and refs needed in the script.
- Always clean up `/tmp/verification-gif-frames/` at the start, not the end
  (preserves frames for debugging if the GIF is wrong).
- If the GIF exceeds 5MB, reduce `max_colors` to 64 or scale to 640px width.
- Never commit the GIF to the repo. It goes to Desktop or gets attached to Jira.
