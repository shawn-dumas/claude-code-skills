---
name: test-extension-auth
description: End-to-end verifies the 8Flow browser extension's magic-link sign-in against a UF host. Drives Chrome via the claude-in-chrome MCP, extracts the Firebase magic link via the Gmail MCP, completes the redirect, and verifies the extension picked up the auth. Use when the user wants to confirm the extension auth flow works against local or a deployed UF env.
argument-hint: <host> [email]
---

# Test Extension Auth Flow

End-to-end verification that the 8Flow browser extension can sign in via magic link against a given UF host. Replaces the manual "paste the callback URL" loop from the magic-link dev workflow.

## Prerequisites

Before running:

1. **8Flow extension loaded** in the same Chrome window that `claude-in-chrome` drives. Dev build or sideload is fine.
2. **Gmail MCP authenticated** as the mailbox that receives magic-link emails (typically `shawn@8flow.com`). Verify with `/mcp` — should show "claude.ai Gmail · connected".
3. **No active UF session in that Chrome window for the target host** — stale cookies will cause the sign-in page to skip the email step and redirect. If unsure, open the target in an Incognito-equivalent or clear cookies for the host first.

## Inputs

- `host` (required) — full UF origin, e.g. `http://localhost:3000`, `https://app2-development.8flow.com`, `https://app-staging.8flow.com`. No trailing slash.
- `email` (optional, default `shawn@8flow.com`) — the email the magic link is sent to. Must match a mailbox the Gmail MCP is authenticated against.
- `extensionId` (optional) — the 8Flow extension's Chrome extension ID. Needed for the storage verification step. If not provided, resolve it at run time by navigating to `chrome://extensions` and reading the ID from the 8Flow extension card (requires Developer mode on). Cache it for reuse across runs.

If `host` or `email` is missing when invoked, ask the user — don't guess.

## Why `?extension=true`

The sign-in page behaves differently when loaded with `?extension=true`: UF renders the extension-context flow, and the admin app is gated off (per the external-app render gate invariant). The extension is the only legitimate caller of `?extension=true`. Driving the flow through that URL is what makes this an extension-auth test rather than an admin-app-auth test.

## Flow

### 1. Navigate to extension sign-in

```
chrome MCP: tabs_create_mcp  url=<host>/signin?extension=true
```

Wait for DOM ready. Capture the tab id — used later for the callback redirect and tab-close verification.

### 2. Submit email

Use `chrome MCP form_input` to fill the "Work email" field with the email argument, then click the "Continue with email" button. On the extension-context sign-in page the next step is the magic-link send, not SSO — there is no Okta step here.

Click the "Send magic link" (or equivalent) button. Record a wall-clock timestamp immediately after — this becomes the floor for the Gmail search window.

### 3. Find the magic-link email

```
gmail MCP: gmail_search_messages
  query: from:noreply@*firebaseapp.com newer_than:2m
```

The Firebase sign-in-link sender is `noreply@<firebase-project-id>.firebaseapp.com`. Two minutes is a reasonable window; if nothing matches after 30s, retry once before failing — Gmail indexing can lag.

If multiple messages match, pick the newest whose internal date is after the send timestamp.

### 4. Extract the magic-link URL

```
gmail MCP: gmail_read_message  id=<message_id>
```

The email body contains an HTML `<a>` with the sign-in URL. Regex the `href` that points at the Firebase continue URL. The URL contains a `continueUrl` query param that typically points back to the target host's `/signin-confirm` path.

Do NOT follow the link via a Gmail-click — that opens Firebase's redirect in whatever default browser / profile, which may not be the claude-in-chrome session. We open it directly in step 5.

### 5. Open the magic link

```
chrome MCP: navigate  url=<extracted-magic-link>  tabId=<sign-in tab id>
```

Reuse the same tab so the session and cookies line up. Firebase validates the magic link in the browser that initiated it — new tabs in other profiles will fail with "link expired" errors.

The flow lands at `<host>/signin-confirm?...` (plus query params including `apiKey`, `oobCode`, `mode=signIn`).

### 6. Verify

Three verification signals. **(a)** is the source of truth — the extension is only "signed in" when `chrome.storage.local` holds the expected auth keys. **(b)** and **(c)** are corroborating signals that help diagnose where a failure happened if (a) doesn't land.

**(a) chrome.storage.local inspection (primary).**

The 8Flow extension writes its auth state into `chrome.storage.local` via `handleOnAuthStateChange`. We read it by navigating a new tab to one of the extension's own pages (which has `chrome.*` API access), then executing JS against `chrome.storage.local.get`.

```
chrome MCP: tabs_create_mcp  url=chrome-extension://<extensionId>/pages/options/index.html
chrome MCP: javascript_tool  code=`
  const keys = await chrome.storage.local.get([
    'user', 'loggedIn', 'token', 'memberRole', 'currentUser', 'featureFlags'
  ]);
  const authUserKey = Object.keys(await chrome.storage.local.get(null))
    .find(k => k.startsWith('firebase:authUser:'));
  const firebaseAuth = authUserKey
    ? await chrome.storage.local.get(authUserKey)
    : null;
  return { keys, firebaseAuthKey: authUserKey, firebaseAuth };
`
```

Expected for a freshly-signed-in state:
- `loggedIn` is truthy
- `user` is a non-empty object with at least `uid` and `email`
- `token` is a non-empty string
- A `firebase:authUser:<apiKey>:[DEFAULT]` key exists and its value contains the signed-in email

Expected for a stale / not-signed-in state:
- `loggedIn` absent or falsy
- `user` absent
- No `firebase:authUser:*` key

Assert against the signed-in shape. If the result is ambiguous (some keys present, others not), dump the full `chrome.storage.local.get(null)` for the user to inspect — that usually reveals a half-completed state.

If `javascript_tool` cannot execute on `chrome-extension://` URLs (Chrome restricts content-script injection on extension pages by default), this is a known limitation of the claude-in-chrome MCP; fall back to (b) and (c) and note in the report that (a) was not checkable.

**(b) Signin-confirm tab closes.**

The extension's `handleOnAuthStateChange` closes the `/signin-confirm` tab once the auth state change fires (see `chrome-extension/src/background/listeners/handleOnAuthStateChange.ts`). Poll `tabs_context_mcp` every 500ms for up to 15s waiting for the sign-in tab id to disappear. Tab closure is a behavioral confirmation that the background worker ran its auth-state handler.

**(c) Signin-confirm page screenshot.**

Before the tab closes, screenshot the DOM via `chrome MCP screenshot`. Success renders a "signed in" / "return to extension" message; stuck states show errors or loading spinners indefinitely. Save the screenshot for the user to eyeball.

### Verdict logic

| (a) storage | (b) tab close | (c) screenshot | Verdict |
|---|---|---|---|
| pass | pass | success UI | PASS |
| pass | pass | error UI | PASS with warning — auth landed, UI is misleading |
| pass | no close | any | PARTIAL — storage set but tab-close listener didn't fire; extension may be in a broken state |
| fail | pass | success UI | FAIL — UI reported success but storage doesn't reflect it; extension-to-UF contract broken |
| fail | no close | any | FAIL — magic link didn't complete; see failure-modes table |
| uncheckable | pass | success UI | PASS (with caveat) — (a) couldn't run, but (b) and (c) both passed |
| uncheckable | no close | any | FAIL — (b) is enough to say the extension didn't pick up auth |

## Failure modes worth surfacing

| Symptom | Likely cause |
|---|---|
| Gmail search returns nothing after 2m | Firebase didn't send — check the send button actually clicked, or email lands in Spam |
| Magic link opens "link expired" immediately | Link followed outside the originating Chrome session, or a previous click consumed it |
| `/signin-confirm` loads but tab never closes | Extension callback host (`VITE_SIGNIN_URL` at build) doesn't match the host the magic link redirected to |
| Sign-in page redirects straight past email | Stale UF session on that host — clear cookies and retry |
| "admin app must not render on ?extension" error | The `?extension=true` query param was dropped somewhere in the redirect chain; check the magic link's `continueUrl` preserved it |

## Reporting

After the run, output:

1. Pass/fail verdict (both signals must pass to PASS)
2. Host and email used
3. Time-to-email (send click → Gmail hit)
4. Time-to-tab-close (magic-link open → tab gone)
5. Path to the saved screenshot
6. If failed: which signal failed and the likely cause from the table above
