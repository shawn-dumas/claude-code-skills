---
name: record-verification-gif
description: Record a verification GIF of a bug fix by driving the browser through a sequence of steps, capturing screenshots at each step, and stitching them into an animated GIF. Optionally attaches the GIF to a Jira ticket.
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_resize, mcp__playwright__browser_click, mcp__playwright__browser_take_screenshot, mcp__playwright__browser_press_key, mcp__playwright__browser_wait_for, mcp__playwright__browser_evaluate, mcp__playwright__browser_fill_form, mcp__playwright__browser_install, mcp__playwright__browser_close, mcp__atlassian__jira_update_issue, Bash(ffmpeg:*), Bash(mkdir:*), Bash(ls:*), Bash(rm:*), Bash(cp:*), Bash(curl:*), Bash(which:*), Bash(brew:*), Read
argument-hint: <ticket-id-or-description> [--attach <JIRA-KEY>] [--output <path>]
---

# Record Verification GIF

Record an animated GIF that demonstrates a bug fix by driving the browser
through a scripted sequence, capturing a screenshot at each step, and
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

Based on `$ARGUMENTS`, plan a sequence of 3-8 steps that demonstrates the
fix. Each step is one of:

| Action | Tool |
|--------|------|
| Navigate to URL | `mcp__playwright__browser_navigate` |
| Resize viewport | `mcp__playwright__browser_resize` |
| Click element | `mcp__playwright__browser_click` |
| Press key | `mcp__playwright__browser_press_key` |
| Wait for text | `mcp__playwright__browser_wait_for` |
| Evaluate JS | `mcp__playwright__browser_evaluate` |

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

### Execute each step

For each step in the sequence:

1. Perform the action (resize, click, navigate, etc.)
2. If needed, wait for content to settle (`mcp__playwright__browser_wait_for`)
3. Take a screenshot: `mcp__playwright__browser_take_screenshot` with
   filename `/tmp/verification-gif-frames/frame<NN>.png` (zero-padded, starting at 01)

Use `mcp__playwright__browser_snapshot` before clicks to find element refs.

---

<!-- role: workflow -->

## Phase 3: Stitch into GIF

### Normalize frame dimensions

Screenshots may have different dimensions (e.g., desktop vs mobile).
Detect the maximum width and height across all frames:

```bash
for f in /tmp/verification-gif-frames/frame*.png; do
  ffmpeg -i "$f" -hide_banner 2>&1 | grep -oP '\d+x\d+'
done
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
ffmpeg -y -start_number 1 -framerate 0.5 \
  -i /tmp/verification-gif-frames/frame%02d_pad.png \
  -vf "scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer" \
  -loop 0 <OUTPUT_PATH>
```

- Default framerate is 0.5 (2 seconds per frame). Use 1.0 for faster playback
  if the sequence has 6+ frames.
- Default output is `~/Desktop/<ticket-or-description>.gif`.

### Verify

```bash
ls -lh <OUTPUT_PATH>
```

Report the frame count, file size, and output path to the user.

---

<!-- role: workflow -->

## Phase 4: Attach to Jira (optional)

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

- Frame filenames are always `frame<NN>.png` (zero-padded two digits).
- Maximum 15 frames. Beyond that, suggest a screen recording tool instead.
- Always clean up `/tmp/verification-gif-frames/` at the start, not the end
  (preserves frames for debugging if the GIF is wrong).
- If the GIF is too large (>5MB), reduce `max_colors` to 64 or scale to 640px width.
- Never commit the GIF to the repo. It goes to Desktop or gets attached to Jira.
