---
name: generate-handoff-tickets
description: Generate and create Jira tickets for the PoC-to-production handoff. Reads the PRD, BFF handoff doc, and implementation plan produced by orchestrate-poc, then creates the standard ticket set (epic, eng review, QE plan, BFF migration, deployments, cleanup).
context: fork
allowed-tools: Read, Grep, Glob, Bash, Write, Edit, TodoWrite, Question, mcp__atlassian__*
argument-hint: <feature slug from orchestrate-poc, e.g. "team-utilization">
---

Generate Jira handoff tickets for a PoC feature. `$ARGUMENTS`

You are the Handoff Ticket Generator. You read the artifacts produced by
`orchestrate-poc` and create the standard set of Jira tickets that
represent the handoff contract between the PM team and Engineering / QE /
DevSecOps.

### Resolve $PLANS_DIR

Before any file operations, determine the plans directory:

```bash
if [ -d ~/plans ]; then echo "PLANS_DIR=~/plans"; else echo "PLANS_DIR=./plans"; fi
```

Use `$PLANS_DIR` for all plan/prompt/cleanup file paths below. Create the
directory (and `$PLANS_DIR/prompts/`) if it does not exist.

## Preconditions

Before proceeding, verify:

1. **Atlassian MCP is available.** Check that `jira_create_issue` and
   `jira_get_sprints_from_board` tools are accessible. The sprint tools
   require the `jira_agile` toolset in the MCP server config
   (`TOOLSETS=default,jira_agile`). If the MCP is not configured, stop
   and tell the user:
   > The Atlassian MCP server is not configured. Add it to your
   > `.claude/settings.json` before running this skill. See the
   > Atlassian MCP setup docs for configuration.

2. **orchestrate-poc artifacts exist.** Look for:
   - `$PLANS_DIR/poc-<slug>.md` (the PRD)
   - `$PLANS_DIR/poc-<slug>-cleanup.md` (the cleanup file)
   - Optionally: `$PLANS_DIR/poc-<slug>-bff-handoff.md`
   - Optionally: `$PLANS_DIR/poc-<slug>-escalation.md`

   If the PRD does not exist, stop and tell the user:
   > No PRD found at `$PLANS_DIR/poc-<slug>.md`. Run `orchestrate-poc`
   > first to generate the planning artifacts.

3. **The PRD status is not `Draft`.** If the PRD still says
   `Status: Draft`, warn the user:
   > The PRD is still in Draft status. Are you sure you want to
   > generate handoff tickets before finalizing it?

   Proceed only if they confirm.

---

## Jira Configuration

<!-- The jira_create_issue MCP tool takes issue type by name (e.g.,
     "Epic", "Task"), not by numeric ID. The IDs below are for reference
     only (useful if debugging via direct API calls). -->

| Setting | Value |
|---------|-------|
| Project key | `AV` |
| Board | `Alpha Board` (id: `2`) |
| Epic issue type ID | `10000` |
| Story issue type ID | `10009` |
| Task issue type ID | `10002` |
| Sub-task issue type ID | `10003` |
| Component: Frontend | `Frontend` |
| Component: Backend/BFF | `Backend` |
| Component: Infrastructure | `Infrastructure` |
| Component: QE | `QE` |
| Default sprint | `current` |

---

## Step 1: Read the Artifacts

Read all available artifacts for the given feature slug:

```
$PLANS_DIR/poc-<slug>.md              -- PRD (required)
$PLANS_DIR/poc-<slug>-cleanup.md      -- Cleanup file (required)
$PLANS_DIR/poc-<slug>-bff-handoff.md  -- BFF handoff (optional)
$PLANS_DIR/poc-<slug>-escalation.md   -- Escalation report (optional)
```

Extract from the PRD:
- Feature name
- Feature slug
- Feature flag name
- Target roles / permissions
- Data entities (existing vs new/extended)
- API endpoints (new or modified)
- Key files created/modified
- Test file paths
- Gotchas / known deviations
- Out of scope items

Extract from the BFF handoff (if present):
- Endpoint list with implementation paths (new vs extend existing)
- Schema file locations
- Mock route locations
- Data source details

Extract from the cleanup file:
- Count of remaining items
- Any `[NEEDS ENG REVIEW]` items
- Any `INTEGRATION VERIFY` items

Extract from the escalation report (if present):
- Escalation reason
- Items requiring engineering review
- Items a cleanup prompt could handle

---

## Step 2: Determine the Ticket Set

The standard handoff produces 8 ticket types. Some are conditional.

| # | Ticket | Type | Always? | Condition |
|---|--------|------|---------|-----------|
| 1 | Feature epic | Epic | Yes | -- |
| 2 | Eng code review | Task | Yes | -- |
| 3 | QE test plan + automation | Story | Yes | -- |
| 4 | BFF migration | Story | No | BFF handoff doc exists |
| 5 | Database / schema changes | Task | No | BFF handoff indicates DB changes |
| 6 | Deploy to dev | Task | Yes | -- |
| 7 | Deploy to staging | Task | Yes | -- |
| 8 | Deploy to production | Task | Yes | -- |
| 9 | Feature flag cleanup | Task | Yes | -- |
| 10 | PoC environment decommission | Task | Yes | -- |

Additional tickets may be generated from:
- Escalation report items tagged `[NEEDS ENG REVIEW]`
- Cleanup items that require human judgment
- BFF handoff endpoints (one sub-task per endpoint if multiple)

---

## Step 3: Build Ticket Content

For each ticket, populate the template below. Every field marked `*` is
required. Do not leave required fields blank -- use `N/A` or `TBD` if
the information is genuinely not available.

### Ticket Template

All tickets follow this structure. The description field in Jira uses
Atlassian Document Format (ADF). Format the content accordingly.

---

### Ticket 1: Feature Epic

```
Type: Epic
Summary: [Feature name] -- PoC to Production
Priority: High
Component: Frontend
Labels: poc-handoff, <feature-slug>

Description:
## Summary
Productionize the [feature name] PoC feature. This epic tracks all
work required to move the feature from PoC (fixture-backed, behind
feature flag) to production-ready (real BFF endpoints, full test
coverage, deployed across all environments).

## PRD
$PLANS_DIR/poc-<slug>.md

## Feature Flag
<flag name> -- currently gating the feature in PoC

## Key Decisions
- Data layer: <existing data / new aggregation / entirely new>
- Placement: <dashboard tab / sub-view / standalone page>
- Permissions: <roles that can access>

## PoC Branch
<branch name from PRD>

## Acceptance Criteria
- [ ] All child tickets completed
- [ ] Feature flag removed or promoted to permanent gate
- [ ] PoC environment decommissioned
- [ ] PRD updated to reflect final implementation

## Out of Scope
<from PRD Section 11, or "See PRD for details">

## Resources & References
- PRD: $PLANS_DIR/poc-<slug>.md
- BFF Handoff: $PLANS_DIR/poc-<slug>-bff-handoff.md (if applicable)
- PR: <TBD -- will be created during handoff>
```

---

### Ticket 2: Engineering Code Review

```
Type: Task
Summary: [Eng Review] [Feature name] -- Review PoC PR for production readiness
Priority: High
Component: Frontend
Labels: poc-handoff, eng-review, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Review the PoC pull request for code quality, testability,
maintainability, and alignment with the PRD. This is the primary
engineering gate before the feature enters the release pipeline.

## Acceptance Criteria
- [ ] PR reviewed: code follows DDAU architecture (containers own hooks,
      components receive props only)
- [ ] PR reviewed: all service hooks use fetchApi with Zod schemas
- [ ] PR reviewed: no direct localStorage/sessionStorage access (uses
      typedStorage)
- [ ] PR reviewed: no direct process.env access (uses clientEnv/serverEnv)
- [ ] PR reviewed: feature flag wired correctly and gating all new UI
- [ ] PR reviewed: branded types used for all IDs
- [ ] PR reviewed: no new ESLint warnings or errors
- [ ] tsc --noEmit passes with 0 errors
- [ ] pnpm build passes cleanly
- [ ] Unit test coverage exists for all new components, containers,
      hooks, and utilities
- [ ] Data scoping verified: all data access scoped to organizationId
- [ ] PR approved or changes requested with clear feedback

## Design / Specs
- PRD: $PLANS_DIR/poc-<slug>.md
- Additional design notes: Review against CLAUDE.md architectural rules

## Criteria Notes
- Feature area: <from PRD -- e.g., Dashboard > Platform > [tab name]>
- Key test scenarios:
    1. Happy path: feature renders correctly for authorized roles
    2. Edge case: feature hidden for unauthorized roles
    3. Error: API failure shows appropriate error state
- Regression areas: <from PRD Section 9 -- Gotchas>
- Test data: fixture-backed via buildStandardScenario()
- Known risks: <from PRD Section 9 or "none identified">

## Engineering Notes
- Relevant components: <key file paths from PRD Section 10>
- Known constraints: Must not break existing dashboard tabs
- Data model changes: <Yes/No from PRD Section 4>
- Third-party integrations: None (internal BFF only)
- Performance considerations: <from PRD or "none identified">

## Out of Scope
- BFF endpoint implementation (separate ticket)
- Database schema changes (separate ticket if needed)
- Deployment to environments (separate tickets)

## Resources & References
- PRD: $PLANS_DIR/poc-<slug>.md
- BFF Handoff: $PLANS_DIR/poc-<slug>-bff-handoff.md
- Related Epic: <epic key>
```

---

### Ticket 3: QE Test Plan and Automation

```
Type: Story
Summary: [QE] [Feature name] -- Test plan, automation, and regression
Priority: High
Component: QE
Labels: poc-handoff, needs-qa, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Create test plan for the [feature name] feature. Review existing
automated tests from the PoC, identify gaps, and create additional
automated or manual test cases. Validate PRD acceptance criteria.

## Acceptance Criteria
- [ ] Test plan created covering all PRD acceptance criteria
- [ ] Existing PoC unit tests reviewed for correctness and coverage
- [ ] Additional automated tests created for identified gaps
- [ ] Manual test scenarios documented for:
      - Happy path across all authorized roles
      - Unauthorized role rejection
      - Error states and fallbacks
      - Edge cases from PRD Section 9
- [ ] Regression test areas identified and documented
- [ ] Test results documented for dev environment
- [ ] Test results documented for staging environment
- [ ] Test results documented for production environment

## Design / Specs
- PRD: $PLANS_DIR/poc-<slug>.md
- Screenshots: <from PRD design section or N/A>

## Criteria Notes
- Feature area: <from PRD>
- Key test scenarios:
    1. <from PRD functional requirements, one per line>
    2. <edge cases from PRD Section 9>
    3. <error scenarios: API timeout, empty data, permission denied>
- Devices / platforms: Web -- Chrome, Safari, Firefox
- Regression areas: <adjacent dashboard tabs, shared layout components,
  navigation, filter system>
- Test data: fixture-backed locally; TBD for staging/production
- Known risks: <from PRD Section 9>

## Engineering Notes
- Existing test files: <list from PRD Section 8>
- Test framework: Vitest (unit), Playwright (integration)
- Fixture system: src/fixtures/ (builders + scenario)
- Mock API: src/pages/api/mock/ (fixture-backed)

## Out of Scope
- Performance testing
- Security penetration testing
- Load testing

## Resources & References
- PRD: $PLANS_DIR/poc-<slug>.md
- Testing docs: docs/testing.md
- Integration testing docs: docs/integration-testing.md
- Related Epic: <epic key>
```

---

### Ticket 4: BFF Migration (conditional)

Only create this ticket if `$PLANS_DIR/poc-<slug>-bff-handoff.md` exists.

```
Type: Story
Summary: [BFF] [Feature name] -- Implement production endpoints
Priority: High
Component: Backend
Labels: poc-handoff, bff-migration, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Implement the production BFF endpoints documented in the handoff
specification. The PoC currently serves fixture data via mock routes.
These endpoints replace the mock routes with real data from
<ClickHouse / PostgreSQL / both>.

## Acceptance Criteria
<Generate one checkbox per endpoint from the BFF handoff doc>
- [ ] Endpoint: GET /api/users/data-api/<domain>/<endpoint> --
      implemented, tested, returns data matching the Zod schema
<repeat for each endpoint>
- [ ] All endpoints wrapped with withAuth + withErrorHandler + withMethod
- [ ] All responses validated against frontend Zod schemas
- [ ] Data scoped to organizationId (no cross-tenant leakage)
- [ ] Integration tests pass against real database
- [ ] Service hooks updated: fetchApi routes to /api/ in production

## Design / Specs
- BFF Handoff: $PLANS_DIR/poc-<slug>-bff-handoff.md
- Additional design notes: See docs/bff.md for middleware patterns

## Criteria Notes
- Feature area: BFF API routes
- Key test scenarios:
    1. Happy path: endpoint returns expected data shape for valid auth
    2. Edge case: empty dataset, large dataset, timezone edge cases
    3. Error: invalid auth (401), missing org (403), invalid params (400)
- Regression areas: existing BFF endpoints (shared middleware)
- Test data: seeded database (see docs/bff-user-backend-migration.md)
- Known risks: <from BFF handoff doc edge cases section>

## Engineering Notes
- Relevant service/API: src/pages/api/users/data-api/<domain>/
- Known constraints: Must match Zod schemas in src/shared/types/
- Data model changes: <from BFF handoff -- "extend existing" or "new">
- Existing mock routes: <paths from BFF handoff>
- Performance considerations: <query complexity, data volume, caching>

## Out of Scope
- Frontend changes (already built in PoC)
- Mock route maintenance (stays as-is for mocked mode)

## Resources & References
- BFF Handoff: $PLANS_DIR/poc-<slug>-bff-handoff.md
- BFF Architecture: docs/bff.md
- BFF Migration Guide: docs/bff-user-backend-migration.md
- Related Epic: <epic key>
```

If the BFF handoff has multiple endpoints, create sub-tasks:

```
Type: Sub-task
Summary: [BFF] Implement <endpoint path>
Parent: <BFF migration ticket key>
Priority: Medium
Component: Backend
Labels: bff-migration, <feature-slug>

## Summary
Implement <endpoint description from handoff doc>.

## Acceptance Criteria
- [ ] Handler created at src/pages/api/users/data-api/<domain>/<endpoint>.ts
- [ ] Wrapped with withErrorHandler(withMethod(['GET'], withAuth(handler)))
- [ ] Response validates against <SchemaName> from src/shared/types/
- [ ] Data scoped to ctx.organizationId
- [ ] Integration test created and passing

## Engineering Notes
<Paste the relevant endpoint section from the BFF handoff doc verbatim>
```

---

### Ticket 5: Database / Schema Changes (conditional)

Only create this ticket if the BFF handoff doc indicates database-level
work (new queries, new views, schema changes, ClickHouse materialized
views, etc.).

```
Type: Task
Summary: [DB] [Feature name] -- Database changes for production endpoints
Priority: High
Component: Infrastructure
Labels: poc-handoff, database, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Implement database-level changes required by the [feature name]
production endpoints. These must be deployed to each environment
before the BFF code that depends on them.

## Acceptance Criteria
<Generate from BFF handoff doc data source and transformation sections>
- [ ] <specific DB change -- e.g., "ClickHouse materialized view for
      weekly team utilization aggregation">
- [ ] Changes deployed to dev
- [ ] Changes deployed to staging
- [ ] Changes deployed to production
- [ ] BFF endpoints verified against real data post-deployment

## Engineering Notes
- Data source: <from BFF handoff>
- Transformation: <from BFF handoff -- aggregation, projection, etc.>
- Deployment dependency: Must deploy DB changes BEFORE BFF code
- Rollback plan: <describe or "TBD">

## Out of Scope
- BFF endpoint implementation (separate ticket)
- Frontend changes

## Resources & References
- BFF Handoff: $PLANS_DIR/poc-<slug>-bff-handoff.md
- Related Epic: <epic key>
```

---

### Tickets 6-8: Per-Environment Deployment

Create one ticket per environment: dev, staging, production.

```
Type: Task
Summary: [Deploy] [Feature name] -- Deploy to <environment>
Priority: <High for dev, Medium for staging, High for production>
Component: Infrastructure
Labels: poc-handoff, deployment, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Deploy the [feature name] feature to <environment>. This includes
any prerequisite database changes and the application code.

## Acceptance Criteria
- [ ] Prerequisite: database changes deployed (if applicable)
- [ ] Prerequisite: PR merged to <branch> (dev: development, staging:
      staging, production: main)
- [ ] CI/CD pipeline passes (build, lint, tsc, unit tests)
- [ ] Integration tests pass in <environment>
- [ ] Feature accessible behind feature flag
- [ ] QE regression testing completed for <environment>
- [ ] No new errors in monitoring/logging

## Engineering Notes
- Deploy order: database changes first, then application code
- Feature flag: <flag name> -- must be enabled in PostHog for
  <environment> after deploy
- Known constraints: <from PRD gotchas or "none">
- Rollback: Revert PR merge; feature flag can disable immediately

## Resources & References
- Release process: see Agentic Product Development doc
- Related Epic: <epic key>
```

---

### Ticket 9: Feature Flag Cleanup

```
Type: Task
Summary: [Cleanup] [Feature name] -- Remove feature flag after stable release
Priority: Low
Component: Frontend
Labels: poc-handoff, tech-debt, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Once the [feature name] feature has been stable in production for at
least one release cycle, remove the feature flag and all gating code.

## Acceptance Criteria
- [ ] Feature confirmed stable in production (no rollback needed)
- [ ] Flag removed from PostHog
- [ ] Flag removed from FeatureFlagsToLoad in
      src/shared/hooks/useFeatureFlags/types.ts
- [ ] Flag removed from FeatureFlagsShapeSchema
- [ ] Fallback value removed from constants.ts
- [ ] useFeatureFlagPageGuard call removed from container
- [ ] featureFlag property removed from navigation tab definition
- [ ] Any conditional rendering based on flag simplified
- [ ] tsc --noEmit passes
- [ ] pnpm build passes

## Engineering Notes
- Feature flag name: <from PRD>
- Files that reference the flag: <list from grep>
- This ticket should not be started until the feature has been in
  production for at least 2 weeks with no issues

## Out of Scope
- Anything other than flag removal

## Resources & References
- Feature flag docs: docs/feature-flags.md
- Related Epic: <epic key>
```

---

### Ticket 10: PoC Environment Decommission

```
Type: Task
Summary: [Cleanup] [Feature name] -- Decommission PoC environment
Priority: Low
Component: Infrastructure
Labels: poc-handoff, cleanup, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
Decommission the PoC environment for [feature name] after the handoff
is complete and the feature is deployed to dev. The longer a PoC
environment persists, the higher the risk of drift from production.

## Acceptance Criteria
- [ ] Feature PR merged to development branch
- [ ] PoC branch (poc/<name>) deleted or archived
- [ ] Vercel project for PoC decommissioned (if separate project exists)
- [ ] Any isolated database environments cleaned up
- [ ] Team notified that PoC URL is no longer available

## Engineering Notes
- PoC branch: <from PRD>
- Decommission should happen shortly after handoff completes
- Coordinate with DevOps for infrastructure cleanup

## Out of Scope
- Feature flag removal (separate ticket, happens later)

## Resources & References
- Related Epic: <epic key>
```

---

## Step 4: Generate Additional Tickets from Cleanup / Escalation

If the cleanup file has `[NEEDS ENG REVIEW]` items, create one task per
item (or group by file if multiple items affect the same file):

```
Type: Task
Summary: [Eng Review] [Feature name] -- <short description of finding>
Priority: Medium
Component: Frontend
Labels: poc-handoff, eng-review, <feature-slug>
Parent: <epic key>  (set via additional_fields.parent)

## Summary
<finding description from cleanup file>

## Acceptance Criteria
- [ ] Finding reviewed by engineer
- [ ] Decision made: fix, defer, or accept as-is
- [ ] If fix: code changed, tests updated, PR approved

## Engineering Notes
- File: <file path from cleanup item>
- Context: <why this was flagged during PoC development>
- Discovered during: orchestrate-poc Phase <N>
```

If an escalation report exists, create tasks for each item in the
"Items Requiring Engineering Review" section.

---

## Step 5: Create Tickets in Jira

Create the tickets in dependency order:

1. **Create the Epic first.** Record the epic key.
2. **Create all child tickets** with the epic link set to the epic key.
3. **Create sub-tasks** (BFF endpoint sub-tasks) linked to their parent.

Use the Jira MCP `jira_create_issue` tool for each ticket. Write the
description in **Markdown** -- the MCP tool auto-converts to Atlassian
Document Format (ADF) for Jira Cloud. Do not build ADF manually.

Use `- [ ]` checkbox syntax for acceptance criteria. Use `##` for
section headers. Use backtick fencing for file paths and code.

### Sprint Assignment

Before creating tickets, look up the active sprint:

1. Call `jira_get_sprints_from_board` with `board_id: "2"` and
   `state: "active"` to get the current sprint ID.
2. Record the sprint ID for use after ticket creation.

After all tickets are created, assign them to the sprint:

3. Call `jira_add_issues_to_sprint` with the sprint ID and a
   comma-separated list of all created issue keys.

If no active sprint exists, warn the user and skip sprint assignment.

### Creation Sequence

For each ticket:

1. Build the Markdown description from the template
2. Call `jira_create_issue` with:
   - `project_key`: `"AV"`
   - `issue_type`: type name from template (e.g., `"Epic"`, `"Task"`,
     `"Story"`, `"Sub-task"`)
   - `summary`: ticket title
   - `description`: Markdown content
   - `components`: comma-separated names (e.g., `"Frontend"`,
     `"Backend"`, `"Infrastructure,Frontend"`)
   - `additional_fields`: JSON string with remaining fields:
     ```json
     {
       "priority": {"name": "High"},
       "labels": ["poc-handoff", "<feature-slug>"],
       "parent": {"key": "<epic-key>"}
     }
     ```
     For the epic itself, omit `parent`. For child tickets, set
     `parent.key` to the epic's issue key.
3. Record the returned issue key
4. Report to user: `Created <KEY>: <summary>`

After all tickets are created, output a summary table:

```
## Handoff Tickets Created

| Key | Type | Summary | Assignee |
|-----|------|---------|----------|
| <KEY> | Epic | [Feature name] -- PoC to Production | TBD |
| <KEY> | Task | [Eng Review] ... | TBD |
| <KEY> | Story | [QE] ... | TBD |
| ... | ... | ... | ... |

Epic: <epic key>
Total tickets: N
```

---

## Step 6: Update the PRD

After creating tickets, update the PRD file:
- Add the epic key to the PRD header
- Add a "Handoff Tickets" section listing all created ticket keys
- Update PRD status from `Draft` to `Handoff`

---

## Step 6.5: Generate PR Artifacts

After updating the PRD, generate two artifacts the PM will need when
opening the handoff PR.

### 6.5.1 Commit Summary Table

Parse the git log on the current branch to build a commit summary:

```bash
git log --format="%s%n%b" origin/development..HEAD
```

From the commit messages, extract `Phase` and `Components` trailers.
Aggregate into a table:

```markdown
| Phase | Commits | Components |
|-------|---------|------------|
| 1-types | N | types, schemas, feature-flags |
| 2-fixtures | N | fixtures |
| ... | ... | ... |
| iteration | N | container, components |
```

If commits do not have trailers (pre-protocol commits), group them as
`| pre-protocol | N | unknown |`.

### 6.5.2 Side-Quest Summary

Extract all `Side-quest:` trailers from the git log:

```bash
git log --format="%b" origin/development..HEAD | grep "^Side-quest: "
```

Also check the cleanup file for `TODO(production-bug)` references.
Compile into a checklist:

```markdown
- [ ] <description> (<file:line>)
```

### 6.5.3 Squash Merge Template

Generate the squash-merge commit message using the template from
`docs/git-protocol.md`. Fill in all fields from the PRD header and
the aggregated commit data.

### 6.5.4 Output

Present all three artifacts to the PM:

> **PR artifacts generated.**
>
> When you open the draft PR, paste the following into the PR
> description (the PoC Handoff section of the PR template):
>
> <commit summary table>
> <side-quest checklist>
> <squash merge template>
>
> The engineer merging the PR will use the squash merge template as
> the commit message.

---

## Error Handling

- If Jira MCP returns an error for any ticket, report the error and
  continue with remaining tickets. Do not stop on first failure.
- After all attempts, list any failed tickets and the errors.
- If the epic creation fails, stop entirely (all other tickets depend
  on the epic key).
- If a field is not available in the Jira project (e.g., a custom
  component name), warn the user and skip that field rather than
  failing.
