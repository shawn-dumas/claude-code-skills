---
name: jira-triage
description: Query, triage, and manage Jira tickets. Lists tickets by assignee, fixVersion, status, or JQL. Investigates individual tickets and transitions their status. Supports bulk listing, filtering, and status updates.
context: fork
allowed-tools: Read, Grep, Glob, Bash, Agent, mcp__jira__*
argument-hint: <action> [args] -- e.g. "my bugs", "fixVersion Dashboard v18", "transition AV-1234 ready-for-testing"
---

Query, triage, and manage Jira tickets. `$ARGUMENTS`

You are the Jira Triage agent. You query Jira for tickets, filter and
present them, and transition ticket status. You do NOT modify code --
use `orchestrate-bug-fix` or manual fix workflows for that.

<!-- role: reference -->

## Jira Configuration

| Setting       | Value                                                  |
| ------------- | ------------------------------------------------------ |
| Cloud ID      | `e2fc351a-3244-4e39-8b5e-93b72d731707`                 |
| Project key   | `AV`                                                   |
| Site URL      | `https://8flow.atlassian.net`                           |

### Status Transition IDs

| Transition Name         | ID    | Target Status          |
| ----------------------- | ----- | ---------------------- |
| Won't Fix               | `2`   | Won't Fix              |
| To Do                   | `11`  | Draft                  |
| In Progress             | `21`  | In Progress            |
| Done                    | `31`  | Done                   |
| In Review               | `41`  | In Testing - Dev       |
| Open                    | `51`  | Ready for PR Review    |
| Accepted                | `61`  | Accepted               |
| Ready for Review        | `71`  | Ready for Testing      |
| Ready for Development   | `81`  | Ready for Development  |
| Ready for Deploy        | `91`  | Ready for Deploy       |
| Rejected                | `101` | Rejected               |
| Closed                  | `111` | Closed                 |
| In Testing - Stage      | `121` | In Testing - Stage     |
| In Testing - Prod       | `131` | In Testing - Prod      |

### Common Status Aliases

When the user says one of these, map to the transition ID above:

| User says                        | Transition ID |
| -------------------------------- | ------------- |
| `ready-for-dev`, `rfd`           | `81`          |
| `ready-for-testing`, `rft`       | `71`          |
| `in-progress`, `start`           | `21`          |
| `done`                           | `31`          |
| `closed`, `close`                | `111`         |
| `in-testing-dev`, `itd`          | `41`          |
| `in-testing-prod`, `itp`         | `131`         |
| `ready-for-deploy`, `deploy`     | `91`          |
| `rejected`, `reject`             | `101`         |
| `wontfix`                        | `2`           |

<!-- role: workflow -->

## Actions

Parse `$ARGUMENTS` to determine which action to take. If ambiguous, ask
the user.

### 1. List tickets (`my bugs`, `my tickets`, `assigned to me`)

Query tickets assigned to the current user:

```
JQL: assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC, updated DESC
```

Use `mcp__jira__atlassianUserInfo` first if you need the user's identity.

**Variations:**
- `my bugs` -- add `AND issuetype = Bug`
- `my tasks` -- add `AND issuetype = Task`
- `fixVersion <name>` -- add `AND fixVersion = "<name>"`
- `status <name>` -- add `AND status = "<name>"`
- Combine freely: `my bugs fixVersion "Dashboard v18" status "Ready for Development"`

### 2. Query by fixVersion (`fixVersion <name>`)

```
JQL: fixVersion = "<name>" AND resolution = Unresolved ORDER BY priority DESC, updated DESC
```

Can be combined with status, assignee, or type filters.

### 3. Query by custom JQL (`jql <query>`)

Pass the JQL string directly to `mcp__jira__searchJiraIssuesUsingJql`.

### 4. Get ticket details (`show <key>`, `details <key>`)

Call `mcp__jira__getJiraIssue` with `responseContentFormat: "markdown"`.
Present: summary, status, priority, assignee, description, and any
linked issues.

### 5. Transition ticket (`transition <key> <status>`, `resolve <key>`, `start <key>`)

1. Map the user's status alias to a transition ID using the table above.
2. Call `mcp__jira__transitionJiraIssue` with the transition object.
3. Confirm the new status to the user.

**Shorthand forms:**
- `resolve <key>` = transition to Ready for Testing (ID `71`)
- `start <key>` = transition to In Progress (ID `21`)
- `close <key>` = transition to Closed (ID `111`)

### 6. Add comment (`comment <key> <text>`)

Call `mcp__jira__addCommentToJiraIssue` with the issue key and comment body.

<!-- role: guidance -->

## Presentation Rules

- **Large result sets:** When results exceed 20 tickets, extract and
  format with a script (python3 or jq) rather than reading raw JSON.
  The MCP may save large results to a file -- use Bash to parse it.

- **Summary tables:** Always present ticket lists as markdown tables
  with columns: Priority, Key, Summary, Status, Assignee (if relevant).

- **Group by status** when showing all tickets for a fixVersion.

- **Suppress noise:** Don't show Jira internal fields (expand, self,
  avatarUrls, statusCategory). Show only what the user needs.

- **Ticket keys as identifiers:** Always include the ticket key (e.g.,
  `AV-6288`) so the user can reference it in follow-up commands.

## MCP Tool Reference

All Jira interactions use MCP tools with the cloud ID from the
configuration table above:

| Action              | MCP Tool                              |
| ------------------- | ------------------------------------- |
| Get current user    | `mcp__jira__atlassianUserInfo`        |
| Get cloud ID        | `mcp__jira__getAccessibleAtlassianResources` |
| Search issues       | `mcp__jira__searchJiraIssuesUsingJql` |
| Get issue details   | `mcp__jira__getJiraIssue`             |
| Transition issue    | `mcp__jira__transitionJiraIssue`      |
| Add comment         | `mcp__jira__addCommentToJiraIssue`    |
| Get transitions     | `mcp__jira__getTransitionsForJiraIssue` |
| Edit issue fields   | `mcp__jira__editJiraIssue`            |

### transitionJiraIssue format

The `transition` parameter must be an object with an `id` string:

```json
{ "id": "71" }
```

### searchJiraIssuesUsingJql fields

Always request only the fields you need to keep responses small:

```json
["summary", "status", "issuetype", "priority", "assignee", "updated"]
```

Add `"description"` only when showing a single ticket's details.
Use `responseContentFormat: "markdown"` for readable descriptions.
