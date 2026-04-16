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
2. **Extension signed out**. The sign-in flow only runs when the extension has no stored user. Sign out from the extension popup, or clear its storage (see step 0 below), before running this skill. A previously-signed-in extension will not re-run the email step and the skill will look like an instant pass without actually testing anything.
3. **Gmail MCP authenticated** as the mailbox that receives magic-link emails (typically `shawn@8flow.com`). Verify with `/mcp`. Should show "claude.ai Gmail connected".
4. **No active UF session in that Chrome window for the target host**. Stale cookies will cause the sign-in page to skip the email step and redirect. If unsure, open the target in an Incognito-equivalent or clear cookies for the host first.

## Inputs

- `host` (required). Full UF origin. Only the hosts the extension's tab-close regex recognizes will produce signal (b):
  - `https://app.8flow.com`
  - `https://app-development.8flow.com`
  - `https://app-staging.8flow.com`

  Other hosts (`http://localhost:3000`, `https://app2-development.8flow.com`, preview deploys) can still run the flow, but signal (b) is expected to read "no close" and the verdict table handling must fall back to signals (a) and (c). The tab-close regex lives at `chrome-extension/src/background/listeners/handleOnAuthStateChange.ts` line 75; update this list if that regex changes. No trailing slash.
- `email` (optional, default `shawn@8flow.com`). The email the magic link is sent to. Must match a mailbox the Gmail MCP is authenticated against.
- `extensionId` (optional). The 8Flow extension's Chrome extension ID. Needed for the storage verification step. `chrome://extensions` cannot be loaded under claude-in-chrome's default tier, so prefer one of these resolvers:
  - Cache a known ID in the skill output from a prior run and reuse it.
  - Call `chrome.management.getAll()` via `javascript_tool` from an existing extension page (any `chrome-extension://<id>/...` page in the same profile has access).
  - Ask the user to paste the ID.

If `host` or `email` is missing when invoked, ask the user. Do not guess.

## Why `?extension=true`

The sign-in page behaves differently when loaded with `?extension=true`: UF renders the extension-context flow, and the admin app is gated off (per the external-app render gate invariant enforced in `SignedInPageShell` and `onSuccessfulLogin`; see memory entry `project_uf_external_app_render_gate.md`). The extension is the only legitimate caller of `?extension=true`. Driving the flow through that URL is what makes this an extension-auth test rather than an admin-app-auth test.

## Tool-name conventions

This skill uses shorthand `mcp:<tool>` throughout. The real tool names are:

| Shorthand | Real tool name |
|---|---|
| `chrome mcp: tabs_create_mcp` | `mcp__claude-in-chrome__tabs_create_mcp` |
| `chrome mcp: tabs_context_mcp` | `mcp__claude-in-chrome__tabs_context_mcp` |
| `chrome mcp: navigate` | `mcp__claude-in-chrome__navigate` |
| `chrome mcp: form_input` | `mcp__claude-in-chrome__form_input` |
| `chrome mcp: javascript_tool` | `mcp__claude-in-chrome__javascript_tool` |
| `chrome mcp: left_click` | `mcp__claude-in-chrome__left_click` (note: no dedicated `click` tool. Use `form_input` for form-element clicks or `javascript_tool` with a `.click()` for arbitrary elements) |
| `screenshot` | `mcp__playwright__browser_take_screenshot` or `mcp__computer-use__screenshot`. `claude-in-chrome` does not export a `screenshot` tool. |
| `gmail mcp: gmail_search_messages` | `mcp__claude_ai_Gmail__gmail_search_messages` |
| `gmail mcp: gmail_read_message` | `mcp__claude_ai_Gmail__gmail_read_message` |

Load each via `ToolSearch` with `select:<real name>` before the first call.

## Flow

### 0. (Optional) Sign the extension out

If prerequisite 2 has not been satisfied manually, clear the extension's stored user first. Navigate to any extension page (e.g., `chrome-extension://<extensionId>/pages/options/index.html`) and run:

```
chrome mcp: javascript_tool  code=`
  await chrome.storage.local.clear();
  return { cleared: true };
`
```

This guarantees the next visit to `<host>/signin?extension=true` presents the email input, not a pre-authed redirect.

### 1. Navigate to extension sign-in

```
chrome mcp: tabs_create_mcp  url=<host>/signin?extension=true
```

Wait for DOM ready. Capture the tab id. Used later for the callback redirect and tab-close verification.

### 2. Submit email

The UF sign-in page on `?extension=true` has a single email field ("Work email") and a single submit button. On submit, UF calls `sendSignInLinkToEmail` directly. There is no separate "Send magic link" step. There is no Okta/SSO step.

Steps, in order:

1. `form_input` to fill the "Work email" field with the email argument. Do NOT submit via `form_input`'s submit option yet. Separate the click so the timestamp (below) aligns with the click, not with an earlier fill.
2. Click the primary submit button on the form (its label is typically "Continue" or "Continue with email"). Use `form_input` with its click behavior if the tool supports it, or `javascript_tool` with `document.querySelector('button[type="submit"]').click()`.
3. Record a wall-clock timestamp the instant the click returns. This becomes the floor for the Gmail search window.

If a second button ("Send magic link") appears after step 2, click it and record the timestamp after that click instead. Flag the two-button variant in the output. The memory entry `feedback_magic_link_auth.md` records the one-button behavior as current but UF flow changes would invalidate this assumption.

### 3. Find the magic-link email

```
gmail mcp: gmail_search_messages
  query: from:noreply subject:"Sign in" newer_than:5m
```

Firebase sends sign-in-link emails from `noreply@<firebase-project-id>.firebaseapp.com`. Gmail's `from:` qualifier does not reliably glob on subdomains, so the query above uses a broader `from:noreply` plus a subject filter. `newer_than:5m` accommodates Gmail index lag. If nothing matches after 30s, retry once before failing.

Filter the returned messages client-side: discard any whose `internalDate` is earlier than the send timestamp from step 2, then pick the newest remaining. If none remain, fail with "Gmail returned results but none newer than send timestamp."

### 4. Extract the magic-link URL

```
gmail mcp: gmail_read_message  id=<message_id>
```

The email body contains an HTML `<a>` with the sign-in URL. Regex the `href` that points at the Firebase continue URL. The URL contains a `continueUrl` query param that typically points back to the target host's `/signin-confirm` path.

Do NOT follow the link via a Gmail-click. That opens Firebase's redirect in whatever default browser/profile, which may not be the claude-in-chrome session. Open it directly in step 5.

### 5. Open the magic link

```
chrome mcp: navigate  url=<extracted-magic-link>  tabId=<sign-in tab id>
```

Reuse the same tab so the session and cookies line up. Firebase validates the magic link in the browser that initiated it. New tabs in other profiles will fail with "link expired" errors.

The flow lands at `<host>/signin-confirm?...` (plus query params including `apiKey`, `oobCode`, `mode=signIn`).

### 6. Verify

Three verification signals. **(a)** is the source of truth: the extension is only "signed in" when `chrome.storage.local` holds the expected auth keys. **(b)** and **(c)** are corroborating signals that help diagnose where a failure happened if (a) doesn't land.

**(a) chrome.storage.local inspection (primary).**

The 8Flow extension writes its auth state into `chrome.storage.local` via `handleOnAuthStateChange` (`chrome-extension/src/background/listeners/handleOnAuthStateChange.ts`). The keys actually written on a fresh sign-in are:

- `user`: the Firebase `User` object (copy of `authUser`, then overwritten with `auth.currentUser`)
- `userState`: `{ uid, company }` where company is resolved via `getCompanyName(uid)`
- `firebase:authUser:<apiKey>:[DEFAULT]`: Firebase Web SDK's own persisted auth record

The internal `globalState` object (persisted by `setGlobalState` through `DBStore`) also updates. It has fields like `loggedIn` and `currentUser`, but those are inside the state store's internal shape. Do not assert `loggedIn`, `token`, `memberRole`, or `currentUser` as top-level `chrome.storage.local` keys: they are not written there by the sign-in path.

We read storage by navigating a new tab to one of the extension's own pages (which has `chrome.*` API access), then executing JS against `chrome.storage.local.get`.

```
chrome mcp: tabs_create_mcp  url=chrome-extension://<extensionId>/pages/options/index.html
chrome mcp: javascript_tool  code=`
  const all = await chrome.storage.local.get(null);
  const authUserKey = Object.keys(all).find(k => k.startsWith('firebase:authUser:'));
  return {
    user: all.user ?? null,
    userState: all.userState ?? null,
    firebaseAuthKey: authUserKey ?? null,
    firebaseAuth: authUserKey ? all[authUserKey] : null,
    allKeys: Object.keys(all),
  };
`
```

Expected for a freshly-signed-in state:
- `user` is a non-empty object with at least `uid` and `email`, and `email` equals the email input
- `userState` is an object with `uid` matching `user.uid`
- A `firebase:authUser:<apiKey>:[DEFAULT]` key exists and its value contains the signed-in email

Expected for a stale / not-signed-in state:
- `user` is null or absent
- `userState` is null or absent
- No `firebase:authUser:*` key

Assert against the signed-in shape. If the result is ambiguous (some keys present, others not), include `allKeys` in the report. A half-completed state usually shows as `firebase:authUser:*` present but `user` null, which means the Firebase SDK wrote its persistence record but `handleOnAuthStateChange` hasn't run to completion yet. Retry the read after a 2s wait before concluding.

If `javascript_tool` cannot execute on `chrome-extension://` URLs in a given MCP build, fall back to (b) and (c) and note in the report that (a) was not checkable.

**(b) Signin-confirm tab transitions away from `/signin-confirm`.**

When auth completes, `handleOnAuthStateChange` runs (`chrome-extension/src/background/listeners/handleOnAuthStateChange.ts`, lines 74-98). The exact behavior:

1. Queries all tabs in the last-focused window.
2. Matches tabs whose URL satisfies `/https?:\/\/*(app-development|app-staging|app)[.]8flow[.]com\/signin-confirm/`. This regex matches ONLY the three production-like hosts. It does NOT match `localhost`, `app2-development`, preview deploys, or any path other than `/signin-confirm`.
3. For each matching tab that is NOT the currently active tab: `chrome.tabs.remove(tabId)` (the tab closes).
4. For the currently active tab: `chrome.tabs.update(currentTab.id, { url: VITE_NOTION_URL })`. The tab stays open; its URL changes to the Notion doc URL.

Polling strategy, given that behavior:

- Get the sign-in tab's current state via `tabs_context_mcp` every 500ms for up to 15s.
- Pass condition: the tab's URL no longer starts with `<host>/signin-confirm`. This covers both the "other tab closed" case and the "active tab URL replaced with VITE_NOTION_URL" case. Either is a behavioral confirmation that `handleOnAuthStateChange` ran.
- Fail condition: 15s elapsed and the URL still matches `/signin-confirm`.

For hosts outside the regex's three matches, the handler's tab-manipulation branch does not fire even on a successful sign-in. Signal (b) is expected to time out and is NOT a failure indicator in that case. The verdict table handles that via the "b not applicable" row.

**(c) Signin-confirm page screenshot.**

Before the tab transitions away, screenshot the DOM. Use `mcp__playwright__browser_take_screenshot` (or `mcp__computer-use__screenshot` if playwright is unavailable). Success renders a "signed in" / "return to extension" message; stuck states show errors or loading spinners indefinitely. Save the screenshot for the user to eyeball.

### Verdict logic

"b not applicable" means the `host` is not in the three-host list the extension's regex recognizes. Signal (b) cannot contribute for those hosts and is excluded from the verdict.

| (a) storage | (b) tab transition | (c) screenshot | Verdict |
|---|---|---|---|
| pass | pass | success UI | PASS |
| pass | pass | error UI | PASS with warning. Auth landed, UI is misleading |
| pass | no transition | any | PARTIAL. Storage set but the handler's tab branch did not run. Likely a regex mismatch; check that `host` is in the three-host list |
| pass | b not applicable | success UI | PASS |
| pass | b not applicable | error UI | PASS with warning |
| fail | pass | success UI | FAIL. UI reported success but storage does not reflect it. Extension-to-UF contract broken |
| fail | no transition | any | FAIL. Magic link did not complete. See failure-modes table |
| fail | b not applicable | success UI | FAIL. Storage is the source of truth |
| uncheckable | pass | success UI | PASS with caveat. (a) could not run, but (b) and (c) both passed |
| uncheckable | no transition | any | FAIL. (b) is enough to say the extension did not pick up auth (for in-regex hosts) |
| uncheckable | b not applicable | any | INCONCLUSIVE. Only (c) remains, which is not authoritative. Ask the user to check the extension manually |

## Failure modes worth surfacing

| Symptom | Likely cause |
|---|---|
| Gmail search returns nothing after 5m | Firebase did not send. Check the send button actually clicked, or the email lands in Spam. Also try relaxing the `from:` filter if Firebase project changed |
| Magic link opens "link expired" immediately | Link followed outside the originating Chrome session, or a previous click consumed it |
| `/signin-confirm` loads but tab never transitions (for an in-regex host) | `handleOnAuthStateChange` did not fire, or the magic link's `continueUrl` points at a host outside the regex's three matches. Inspect the `continueUrl` in the email before opening it |
| Sign-in page redirects straight past email | Stale UF session on that host, OR the extension is already signed in. Clear cookies for the host and run step 0 (clear extension storage), then retry |
| "admin app must not render on ?extension" error | The `?extension=true` query param was dropped somewhere in the redirect chain. The invariant is enforced in `SignedInPageShell` and `onSuccessfulLogin` in UF. Check the magic link's `continueUrl` preserved `?extension=true` |
| Storage `firebase:authUser:*` key exists but `user` is null after 2s retry | `handleOnAuthStateChange` started but did not complete. Check extension service worker logs via `chrome://extensions` (Inspect views: service worker). Likely culprits: `getCompanyName` API failure, or `auth.currentUser` race |

## Reporting

After the run, output:

1. Pass/fail verdict using the verdict-logic table. Include which signals contributed
2. Host and email used
3. Time-to-email (send click to Gmail hit)
4. Time-to-transition (magic-link open to the sign-in tab's URL leaving `/signin-confirm`), or "not applicable" if the host is out-of-regex
5. Path to the saved screenshot
6. The `allKeys` list from signal (a) if storage was uncheckable or ambiguous
7. If failed: which signal(s) failed and the likely cause from the failure-modes table
