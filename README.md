# Claude Code Skills

A set of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that enforce consistent architecture across the codebase. The **audit** skills are read-only diagnostics that score code against principles and produce violation reports. The **refactor** skills fix those violations. The **build** skills generate new code that follows the same principles from the start. All write skills verify with TypeScript and tests before finishing.

These skills are opinionated. They encode a specific architectural model that prioritizes explicit data flow, clear ownership boundaries, and minimal coupling. If your codebase follows different conventions, you will want to fork and adapt them.

## General Code Principles

These 10 principles apply to all non-trivial TypeScript code in the project -- utilities, server-side processing, API handlers, schemas, scripts, and shared libraries. The React-specific principles in the next section are specializations of these general rules applied to the component model.

### G1 -- Single Job Per Module

A file does one thing. A utility formats dates. A schema validates one endpoint's shape. A dataset loader fetches and transforms one dataset. If you need a second paragraph to explain what a file does, it is two files.

*Test: Can you name the file's job in under 8 words?*

### G2 -- Explicit Inputs, Explicit Outputs

Every function declares what it needs (parameters) and what it returns (typed return). No reaching into closures for data. No mutating arguments. No ambient dependencies (env vars, globals) without them being passed in or documented at the module top.

*Exception: Logger and config singletons at module scope are acceptable if declared at the top of the file.*

### G3 -- Duplication Over Bad Abstraction

Two or three similar blocks of code are fine. Only extract a shared function when (a) the pattern has appeared 3+ times, (b) the shared shape is stable (not still evolving), and (c) the abstraction makes each call site simpler, not just shorter.

*Test: If the abstraction needs a boolean flag or mode parameter to handle the variants, it is probably two functions.*

### G4 -- Low Cyclomatic Complexity

Keep branching shallow. Prefer early returns over nested if/else. Prefer lookup objects/maps over switch statements. Prefer guard clauses that exit early. Target: no function exceeds complexity of roughly 5 (one main path plus a few guards).

*Technique: "Flatten and return early."*

### G5 -- Parse, Don't Validate

Trust boundaries (API responses, user input, env vars, CSV rows) get parsed once into typed, branded values. After that point, code operates on trusted types -- no defensive re-checking. Interior code trusts its inputs.

*Aligns with the existing Zod-at-the-boundary pattern and branded types from `src/shared/types/brand.ts`.*

### G6 -- Pure Core, Effects at the Edge

Separate computation from side effects. Data transformation functions should be pure (same input, same output, no I/O). Side effects (database calls, file writes, API requests, logging) happen in a thin outer layer that calls into pure functions.

*Benefits: testable without mocks, composable, predictable.*

### G7 -- Narrow Exports

A module exports only what other modules consume. Internal helpers stay unexported. Barrel files (`index.ts`) are the public API. If you export something "just in case," delete it.

*Aligns with the existing cross-domain import rule.*

### G8 -- Types as Documentation

The type signature should tell the full story. If someone needs to read the function body to understand the contract, the types are too loose. Use branded types, discriminated unions, and literal types to make invalid states unrepresentable.

*Corollary: Comments explain "why," types explain "what."*

### G9 -- Composition Over Configuration

Prefer composing small, focused functions (pipe, chain, sequence) over building one function that takes an options object. When you see `{ mode: 'A' | 'B', includeX?: boolean }`, consider whether that is really two separate functions.

*Ties directly into G3 -- a configurable abstraction is often a bad abstraction.*

### G10 -- Fail Loud, Fail Fast

At trust boundaries, throw or return typed errors immediately. No silently swallowing. No fallback defaults that hide bugs. Interior code can assume valid data (because G5 already parsed it). When something unexpected happens, surface it -- do not paper over it.

## React Principles

The following principles specialize the general rules above for React's component model. DDAU is G2 applied to components. Least power is G1 + G9 applied to hooks and context. Template least-power is G4 applied to JSX.

Every React skill in this repo enforces these rules. Understanding them is more important than memorizing the individual skills.

### Data Down, Actions Up (DDAU)

A component's Props interface is its complete dependency list. Data arrives via props. Actions fire via callback props. The component never reaches into global state, context, or the router on its own. After refactoring, you should be able to render the component with nothing but props -- no provider tree required.

The exception is ambient UI hooks (DOM utilities, theme, i18n) and narrow scoped contexts that meet the escape-hatch criteria. These are allowed in leaves and documented in the [ambient dependencies](#ambient-dependencies-and-the-prop-drilling-escape-hatch) section below.

### Container boundaries

Every entry point has one container component that sits between the outside world (hooks, context, routing, storage, toasts) and the inside world (props-only components). The container calls all service hooks, context hooks, and router hooks. It passes data down and wires callbacks up. Children never call these hooks directly.

Typically this means one container per route. But if a feature is rendered from a non-route entry point (modal, embedded panel, shared surface), that entry point gets its own container. The rule is "one container per orchestration boundary," not "one container per URL."

**Nested containers.** A route container handles route-level orchestration (context, routing, URL state, toasts). An inner container handles section-level orchestration (conditional data fetching triggered by drill-down selections within the route). Inner containers receive context values and navigation callbacks as props from the outer container. They call their own service hooks for data that depends on local selection state. This is acceptable when the section has its own meaningful orchestration boundary -- for example, a systems drill-down panel that fetches span data only when a system is selected.

### File placement: `pages/` is for pages only

In a Next.js Pages Router project, every `.ts`/`.tsx` file under `src/pages/` is treated as a route. Non-page files (containers, components, hooks, utilities, types) must never be created under `pages/`. When extracting a container or sub-component from a page file, place it in `src/ui/page_blocks/` (or the appropriate feature directory), not alongside the page.

Page files under `pages/` should be thin: import the container from `src/ui/page_blocks/`, render it, and attach `getLayout`. Nothing else.

### Separation of concerns

Each layer has a single job:

| Layer             | Responsibility                                                | Must NOT                                                                  |
| ----------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Service hooks** | Fetch and mutate data via useQuery/useMutation                | Fire toasts, navigate, write to storage, import cross-domain query keys   |
| **Containers**    | Wire hooks to components, handle events, manage user feedback | Render complex UI (that belongs in children)                              |
| **Components**    | Render from props                                             | Call service hooks, context hooks, useRouter, or access browser storage   |
| **Providers**     | Hold shared UI state only                                     | Fetch data, own query logic, watch auth state                             |
| **Types**         | Define shape contracts in `src/shared/types/`                 | Contain logic, import runtime code, or duplicate definitions across files |

### Least power

Give each piece of code the minimum capability it needs:

- If a value is computable from props or state, compute it inline or with useMemo. Do not store it in separate state.
- If a component only reads a value, do not pass it the setter.
- If a hook returns 15 fields and every consumer uses 3, narrow the return type.
- If a context has 20 fields and consumers typically use 2-3, split it.
- If a field is an entity ID, timestamp, or duration, give it a branded type, not a bare primitive. The type system should prevent passing a `UserId` where a `WorkstreamId` is expected.

### Template least-power (JSX discipline)

The return statement of a component should be a **declaration of what to render**, not a program that figures out what to render. All decision-making, data transformation, and branching logic lives above the return in named intermediate variables. The return itself is flat, scannable, and free of embedded computation.

#### Rules

1. **No chained ternaries in JSX.** A single binary ternary (`active ? 'on' : 'off'`) or a simple show/hide guard (`{isOpen && <Modal />}`) is fine. The moment you chain ternaries (`a ? X : b ? Y : Z`), extract to a lookup map or a sub-component. Multi-way branching is a switch statement -- write it as one above the return.

2. **Named rendering predicates.** Instead of `{!loading && data && data.length > 0 && <Table />}`, compute `const showTable = !loading && data && data.length > 0` above the return. The name documents the decision. The template consumes it: `{showTable && <Table />}`.

3. **No data transformation in the return.** `.filter()`, `.map()`, `.reduce()`, and especially chained combinations of these belong in `useMemo` or named variables above the return. The return statement receives pre-computed data and lays it out.

4. **No IIFEs in JSX.** `{(() => { ... })()}` inside a return is a function masquerading as markup. Extract to a named variable or a sub-component.

5. **Named event handlers.** An inline handler should be a single function reference: `onClick={handleReset}`. Multi-statement anonymous handlers (`onClick={() => { setA(); setB(); setC(); }}`) become named functions above the return.

6. **Lookup maps for multi-way values.** When a value depends on a discriminant (type, status, mode), use a `Record` lookup above the return instead of a ternary chain in JSX:

   ```tsx
   const colorByType: Record<OpportunityType, string> = {
     'Agentic AI': 'text-purple-600',
     'System Optimization': 'text-blue-600',
     'API Integration': 'text-green-600',
   };
   const iconColor = colorByType[type] ?? 'text-gray-600';
   ```

7. **Minimal inline styles.** `style={{}}` creates a new object on every render. For static styles, use CSS classes. For dynamic computed styles (percentage widths, calculated positions), extract to a named variable above the return. Exception: `@react-pdf/renderer` requires inline style objects -- this is expected for that library.

8. **className construction.** Simple binary toggles in template literals are fine. When a className has 3+ conditions or nested ternaries, extract to a named variable above the return using `clsx`/`cn` or a lookup map. The template should not be solving classification problems.

9. **Shared presentational components for repeated patterns.** When the same rendering pattern (progress bar with percentage width, async content with loading/empty/error states, KPI value with loading ternary) appears in 3+ files, extract a shared component. The pattern exists once; call sites pass data.

#### The intermediate variables contract

The space between hooks and the return statement is where decisions are made. Every intermediate variable should be named to document **what was decided**, not just what was computed:

- `showTable` not `tableVisible` (what was decided: show the table)
- `formattedRows` not `rows` (transformation happened: these are display-ready)
- `statusLabel` not `status` (this is the display string, not the raw enum)
- `iconColor` not `color` (this is specifically the icon's color, derived from type)
- `activeRows` not `filteredData` (what the filter means: only active rows survive)

After refactoring, reading the return statement should tell you the layout. Reading the intermediate variables should tell you the logic. They should not be interleaved.

### ESLint suppression convention

When a rewrite introduces an `eslint-disable` comment, always include an explanation after `--` that says why the rule does not apply. A bare `// eslint-disable-next-line rule-name` is a debug artifact. A commented one (`// eslint-disable-next-line rule-name -- reason`) is a deliberate decision. The audit skill flags bare eslint-disable comments as debug artifacts (Step 3c); the refactor skills must not create new ones.

### Destructuring alias for unused props

When prefixing unused destructured props with `_` to satisfy `no-unused-vars`, use the TypeScript alias syntax. The property name in destructuring must match the type definition:

- Wrong: `{ _unusedProp }` -- TypeScript error, the type defines `unusedProp`
- Right: `{ unusedProp: _unusedProp }` -- alias preserves the property name
- With default: `{ unusedProp: _unusedProp = false }` -- alias + default value

### useEffect discipline

Most useEffects are wrong. Each one gets classified:

| Classification                                                     | Correct action                  |
| ------------------------------------------------------------------ | ------------------------------- |
| Derived state (useEffect + setState where the value is computable) | Replace with useMemo or inline  |
| Prop sync (mirrors a prop into local state)                        | Controlled component or useMemo |
| Event handler in disguise (reacts to state set by a user action)   | Move logic to the event handler |
| Mapper side effect (setState inside TanStack Query `select`)       | Read from `.data` directly      |
| External system subscription (WebSocket, ResizeObserver)           | Keep                            |
| Unmount cleanup                                                    | Keep                            |

### Single-domain ownership

A service hook imports only its own domain's query keys. Cross-domain cache invalidation happens in the container's mutation `onSuccess` callback, not inside the hook. This prevents circular imports and makes invalidation visible at the orchestration layer.

### Type safety and centralization

Types have the same ownership rules as data and state. A type should live in one place and be imported everywhere it is used.

#### Domain type modules

Shared types live in `src/shared/types/<domain>.ts`. Each domain module is the single source of truth for that domain's type definitions. Before defining a new interface, check whether one already exists in `src/shared/types/`. If an existing definition is close but not exact, extend or narrow it with `Pick`/`Omit`/`&` rather than duplicating.

What stays co-located:

- Component `Props` interfaces (the component's contract, used only at the call site)
- Zod schemas and their `z.infer` types (schema and derived type are a unit)
- `as const` objects and their derived types (the type is derived from the runtime value)
- Test mock types (only used in tests)
- Scoped context value types generated by `build-react-provider`

Everything else that is used by 2+ files in different directories belongs in `src/shared/types/`.

#### Branded primitives

Bare `string` and `number` are not acceptable types for entity IDs, timestamps, durations, emails, URLs, or percentages. Use the branded types from `src/shared/types/brand.ts` (e.g., `UserId`, `WorkstreamId`, `ISOTimestamp`, `Seconds`, `Email`, `Percentage`). Branded types are compile-time only -- zero runtime cost -- but they prevent silent ID swapping, unit confusion, and timestamp/date mixing.

The branding boundary is where external data enters the system: API response parsing, CSV row processing, Supabase query results, URL params. The container (or the service hook's `select` function) applies the branded constructor. From that point forward, everything downstream carries the branded type.

#### Enums as `as const`

New discriminator and status types use `as const` objects with derived union types, not TypeScript `enum`. The `as const` pattern has no runtime overhead, narrows better, and is compatible with `satisfies`.

```typescript
export const Role = {
  MEMBER: 'member',
  TEAM_OWNER: 'teamowner',
  ADMIN: 'admin',
} as const;

export type Role = (typeof Role)[keyof typeof Role];
```

#### No `any`, no non-null assertions

`any` defeats the type system. Use `unknown` at trust boundaries and narrow with type guards, `instanceof`, or Zod schemas. Non-null assertions (`!`) are a bet that a value is never null -- use optional chaining (`?.`), nullish coalescing (`??`), or guard clauses instead.

#### Trust boundaries use runtime validation

Data from `JSON.parse`, `localStorage`, `fetch` responses, and Supabase queries must be validated at the point of entry. Use Zod `safeParse`, a sound type guard, or the Supabase typed client (`createClient<Database>(...)`). Do not cast with `as`.

#### Type guards must be sound

A user-defined type guard (`value is T`) must validate enough of `T`'s structure to justify the claim. Checking one key on a 10-property interface is not sound -- it lies to the compiler. For complex shapes, prefer Zod schemas. For simple discriminants, `typeof`, `instanceof`, and `in` are sufficient.

### URL state ownership

The URL is a state store, just like context or localStorage. The same DDAU rules apply: the container reads it, children receive values as props.

State is URL-worthy when it affects what the user sees on reload: filters, sort order, tab selection, date range, pagination, selected team. A user sharing the URL should see the same view. The browser back button should restore it.

What stays out of the URL: session-level identity like company/tenant (multi-tenancy is hidden from customers), ephemeral UI state (modals, tooltips), and form-in-progress data (owned by the form library).

Use [nuqs](https://nuqs.47ng.com/) for type-safe URL search params. The container calls `useQueryState` / `useQueryStates` and passes values as props + setter callbacks. Children never call `useSearchParams`, `router.query`, or `useQueryState` directly -- those are state-store access, same as `useContext` or `localStorage.getItem`.

Start maximalist: put everything URL-worthy into the URL. Remove params that prove noisy. Adding a URL param later is more expensive than removing one.

### Storage tiers

Client-side persistence has three tiers. Each has a different lifetime and appropriate use:

| Tier           | Mechanism      | Lifetime                | Use for                                                                    |
| -------------- | -------------- | ----------------------- | -------------------------------------------------------------------------- |
| **Shareable**  | URL (nuqs)     | Survives share/bookmark | Filters, sort, tab, date range, pagination, selected entity                |
| **Persistent** | localStorage   | Survives close/reopen   | User preferences, theme, dismissed banners, cached selections              |
| **Ephemeral**  | sessionStorage | Dies with the tab       | Drill-down position, scroll offset, expand/collapse state within a session |

sessionStorage for ephemeral drill-down state is not a DDAU violation. It is external-system sync (same category as ResizeObserver or scroll position) -- the component persists its position so the user does not lose context when navigating within a session. The container or inner container that owns the drill-down state is the appropriate owner of the sessionStorage read/write.

### No factory indirection

Service hooks are direct useQuery/useMutation calls. No `createQueryFactory`, no curried wrappers. The hook owns its own `useFetchApi()` call, query key, query function, and options. Factories hide what the hook does and make per-call-site customization harder.

### Ambient dependencies and the prop-drilling escape hatch

DDAU means a component's Props interface is its complete dependency list. That is the default. But "complete" does not mean "every value the component reads from any source." Two categories of dependencies are explicitly exempt.

#### Ambient UI concerns (always allowed in leaves)

Hooks that interact with browser APIs or environment configuration rather than application state are allowed anywhere. They have no provider coupling and do not create hidden business-data dependencies. The criterion is not "is it like the DOM" but "does consuming it create a hidden dependency on application data flow?" If no, it is ambient.

Every skill's MAY-remain list covers these. Examples: `useBreakpoints`, `useWindowSize`, `useClickAway`, `useScrollCallback`, `useTheme`, `useTranslation`.

Note on i18n: translation hooks can depend on user settings, locale, and runtime-loaded dictionaries. They are still classified as ambient because they do not create hidden business-data dependencies between components. If your i18n setup involves data-fetching or cross-domain state, treat it as a provider concern instead.

#### Escape hatch: thin scoped context (rare, explicit)

When a container passes the same value to multiple leaves and the alternative is threading through 3+ intermediate components that do not use it, a thin purpose-built context is the right tradeoff.

**Use scoped context only when all of the following are true:**

- **Stable.** The value changes rarely during a session. Not per keystroke, not per frame, not high churn.
- **Narrow.** One or two primitives, or a small object with a couple of fields. Do not dump an entire user object wholesale.
- **Deep pass-through cost.** Would require threading through 3+ components that do not use the value, or would significantly distort composition.
- **Local scope.** The provider is close to the consuming subtree (feature or route level), not app-wide by default. App-wide ambient concerns (theme, locale) are handled by the category above, not by this escape hatch.
- **No orchestration.** The context holds data, not behaviors with side effects. Actions still route upward via callback props unless the action is also stable and purely local.

**Prefer these alternatives before reaching for context:**

1. Flatten or restructure the tree so the container binds directly to the leaf.
2. Compose using children or render props so the container passes to the deep leaf without intermediaries.
3. Extract a sub-container at an intermediate boundary if there is a meaningful ownership seam.

**Naming and placement convention.** Scoped contexts use the pattern `XxxScopeProvider` colocated with the feature, exporting `useXxxScope()` that returns a narrow typed value. Add `useXxxScope` hooks to the MAY-remain list in each skill so they are not flagged as violations.

#### What this does not permit

- Context as a grab bag (`FeatureContext` with many unrelated fields)
- Context that exposes query clients, router objects, or service hooks
- Context used to avoid thinking about ownership boundaries
- Broad contexts consumed deep in the tree as a convenience -- a component calling `useInsightsContext` to grab 3 fields out of 19 is not an ambient dependency, it is a hidden coupling to a provider that re-renders it on unrelated state changes

The skills enforce the strict default. When you hit a case where prop drilling is genuinely worse, extract a scoped context following the convention above and document why.

## General Code Skills

These skills apply the G1-G10 principles to non-React TypeScript code: utilities, server-side processing, API handlers, schemas, and shared libraries.

### audit-module

**Read-only diagnostic.** Point it at any non-React TypeScript file and it scores every function against G1-G10. Classifies the module type (utility, server processor, API schema, script, constant), detects high cyclomatic complexity, mixed pure/impure code, over-broad exports, untyped trust boundaries, bad abstractions (flag parameters, mode switches), and silent error swallowing.

Run this before `refactor-module`.

```
/audit-module src/shared/utils/date/formatDate.ts
/audit-module src/server/companyData/analyzerDataset.ts
```

### refactor-module

Takes a non-React TypeScript file and rewrites it to comply with G1-G10. Splits mixed-responsibility files, extracts pure functions from side-effectful ones, replaces nested branching with early returns and lookup maps, narrows exports, adds branded types at trust boundaries, and flags (but does not remove) duplication that might be intentional.

```
/refactor-module src/shared/utils/date/formatDate.ts
/refactor-module src/server/companyData/systemsDataset.ts
```

### audit-api-handler

**Read-only diagnostic.** Audits an API route handler together with its `.schema.ts` file. Checks schema completeness (request params, response shape, error responses), handler structure (parse at boundary, pure logic in middle, response at edge), consistent error handling patterns, and Zod schema alignment with the shared type system.

```
/audit-api-handler src/pages/api/productivity.ts
```

## React Refactor Skills

### audit-react-feature

**Read-only diagnostic.** Point it at a feature directory and it produces a full migration report: file inventory, component classifications, useEffect inventory, hook-call-in-leaves table, storage/toast/cross-domain analysis, and a prioritized migration checklist.

Run this first. The refactor skills reference its output.

```
/audit-react-feature src/features/insights
```

### refactor-react-route

Establishes or completes the container boundary for a route. Absorbs all hook calls from children into the container. Ensures the container owns storage, toasts, and cross-domain invalidation.

```
/refactor-react-route src/pages/insights/InsightsPage.tsx
```

### refactor-react-component

Audits a component against all principles (DDAU, least power, useEffect discipline, separation of concerns, state ownership) and rewrites it. Extracts a container if the component is a leaf calling hooks it should not.

```
/refactor-react-component src/features/insights/InsightsTable.tsx
```

### refactor-react-provider

Strips data-fetching from a provider, audits context breadth, removes mapper side effects, replaces logout watchers with a cleanup registry pattern, and optionally splits broad contexts.

```
/refactor-react-provider src/providers/InsightsProvider.tsx
```

### refactor-react-hook

General-purpose hook refactoring. Classifies the hook (service, context-wrapping, DOM utility, state utility, composite) and applies the appropriate rules. If it detects a service hook, it redirects to `refactor-react-service-hook`.

```
/refactor-react-hook src/hooks/useInsightsFilters.ts
```

### refactor-react-service-hook

Dedicated skill for useQuery/useMutation hooks. Strips factory indirection, purifies `select` mappers, removes side effects (toasts, navigation, storage), removes cross-domain key imports, and narrows the return surface.

```
/refactor-react-service-hook src/services/hooks/queries/useInsightsData.ts
```

## React Build Skills

The build skills generate new code that follows the architecture from the start. They survey the surrounding codebase to match conventions, generate files with full type annotations and test skeletons, and verify with `tsc` and the test runner before finishing.

Build and refactor skills produce interchangeable output. A component generated by `build-react-component` looks the same as one rewritten by `refactor-react-component`.

### build-react-service-hook

Generates a new useQuery or useMutation hook. Owns its own `useFetchApi()` call, query key, and query function. Creates or extends the domain's query keys file. No toasts, no navigation, no storage, no cross-domain keys.

```
/build-react-service-hook insights/useWorkloadQuery Fetches workload analysis data for a team
```

### build-react-provider

Generates a scoped context provider (`XxxScopeProvider` / `useXxxScope`). Validates the description against all five escape-hatch criteria before generating. The provider receives its value as props from the container -- it does not compute or fetch its own value.

```
/build-react-provider FilterScope Holds the active filter selections shared across dashboard panels
```

### build-react-route

Generates a Next.js page file and its DDAU container. The page is thin (default export, layout, mount container). The container owns all hooks, context, routing, storage, toasts, and cross-domain invalidation. Lists missing service hooks as prerequisites.

```
/build-react-route insights/workload-analysis Dashboard showing team workload metrics with date range filtering
```

### build-react-component

Generates a DDAU component that receives all data via props and fires actions via callbacks. Creates the component file, barrel export, types file (if needed), and test skeleton. No hooks except the MAY-remain list.

```
/build-react-component dashboard/MetricsCard Displays a single metric with label, value, trend arrow, and optional sparkline
```

### build-react-hook

Generates a DOM utility or state utility hook. Redirects to `build-react-service-hook` if the description suggests data-fetching. Checks for duplicates before generating. Updates the shared hooks barrel.

```
/build-react-hook useDebounce Debounces a value by a configurable delay
```

## Installation

Clone this repo into your Claude Code skills directory:

```bash
# Back up existing skills if you have any
mv ~/.claude/skills ~/.claude/skills.bak

# Clone
gh repo clone shawn-dumas/claude-code-skills ~/.claude/skills
```

Or, if you already have other skills and want to add these alongside them, clone elsewhere and symlink the individual skill directories:

```bash
gh repo clone shawn-dumas/claude-code-skills /tmp/claude-code-skills

for skill in /tmp/claude-code-skills/*/; do
  name=$(basename "$skill")
  ln -s "$skill" ~/.claude/skills/"$name"
done
```

## Workflow

### Refactoring non-React code

1. **Audit first.** Run `audit-module` on the target file. Read the violation report.
2. **Refactor.** Run `refactor-module` on the file. It re-runs the audit internally and applies fixes.
3. **For API handlers:** Run `audit-api-handler` on the handler file. It audits the handler and its schema together. Use `refactor-module` to fix violations.

### Refactoring React code

The ordering is not arbitrary -- it mirrors the dependency graph. You cannot convert components to DDAU until containers exist to absorb their hook calls. Containers cannot be clean until service hooks are standalone and side-effect-free. Service hooks cannot be standalone until factory indirection is eliminated. Each phase unblocks the next.

The audit skill produces a migration checklist in exactly this order, and each checklist item maps to a specific skill invocation. The output of step 1 is the script for steps 2-5.

1. **Audit first.** Run `audit-react-feature` on the feature directory. Read the report. Understand the dependency graph before changing anything.

2. **Service hooks.** Use `refactor-react-service-hook` to clean up data-fetching hooks. Strip side effects, remove factory indirection, enforce single-domain keys. This is the foundation -- containers need clean hooks to wire.

3. **Providers.** Use `refactor-react-provider` to strip data-fetching from providers, split broad contexts, and set up cleanup registration. After this step, providers hold only shared UI state.

4. **Routes/containers.** Use `refactor-react-route` to establish or complete the container boundary for each route. The container absorbs all hook calls, storage, toasts, and cross-domain invalidation.

5. **Components.** Use `refactor-react-component` on remaining self-contained components to convert them to DDAU. At this point the container exists, so the component just needs its hooks removed and its Props interface defined.

6. **Tests.** After refactoring production code, run `audit-react-test` on the affected spec files. Use `refactor-react-test` to fix violations (auto-deletes and delegates to `build-react-test` if beyond repair). Use `build-react-test` to fill coverage gaps for production files that have no spec. Every spec must score 10/10 before the refactor is considered complete.

### Building new code

The build skills follow the same topological order. Each layer depends on the one before it.

1. **Service hooks.** `build-react-service-hook` -- data layer first. The container needs hooks to call.

2. **Providers.** `build-react-provider` -- shared UI state if the feature needs a scoped context. Most features do not.

3. **Routes/containers.** `build-react-route` -- the orchestration boundary. Wires service hooks to components, owns toasts/storage/invalidation.

4. **Components.** `build-react-component` -- leaf UI that renders from props.

5. **Utility hooks.** `build-react-hook` -- DOM or state utilities that any layer might need. These can be created at any point since they have no architectural dependencies.

Each build skill generates a test file that scores 10/10 on `audit-react-test`. If you need to create a standalone test for an existing production file, use `build-react-test` directly.

## Template Cleanup Skills

These skills target JSX template complexity specifically. Use them after DDAU boundaries are established (containers exist, hooks are absorbed) to clean up the markup layer.

### flatten-jsx-template

Behavior-preserving cleanup of a single component's return statement. Lifts chained ternaries, inline transforms, IIFEs, and multi-statement handlers into named intermediate variables above the return. Does not restructure hooks or change data flow.

```
/flatten-jsx-template src/ui/page_blocks/dashboard/systems/SystemsBlock.tsx
```

### extract-shared-presentational

Extracts a repeated rendering pattern from multiple files into a shared component. Identifies all instances, designs a minimal Props interface from the variations, creates the component with tests, and replaces all call sites.

```
/extract-shared-presentational ProgressBar "percentage-width bar with style={{ width }}" src/ui/page_blocks/dashboard/opportunities/components/SystemsTab.tsx src/ui/page_blocks/dashboard/systems/components/ActivitiesTable.tsx
```

## Dependency Management Skills

These skills handle npm dependency auditing, upgrades, and replacements. They work with any Node.js project, not just React codebases.

### audit-npm-deps

**Read-only diagnostic.** Checks all npm dependencies for outdated versions, security vulnerabilities, dead/misplaced deps, and React peerDependency compatibility. Produces a tiered update plan (drop-in patches, minimal changes, substantial migrations).

Run this periodically (quarterly) or before a major upgrade cycle.

```
/audit-npm-deps ~/github/next-gen-atlassian
```

### migrate-npm-package

Upgrades a single package across a breaking version boundary. Finds all usage sites, runs codemods (if provided), applies grep-driven fixes for deprecated APIs, and verifies with tsc/tests/build.

```
/migrate-npm-package next 15 "npx @next/codemod@latest upgrade"
/migrate-npm-package react-flatpickr 4.0.11
/migrate-npm-package react 19
```

### replace-npm-package

Swaps one package for another. Maps the old API surface to the new package, rewrites all import sites, removes the old package, adds the new one, and verifies.

```
/replace-npm-package react-hot-toast sonner "toast() -> toast(), <Toaster /> -> <Toaster />"
/replace-npm-package react-csv react-csv-downloader
```

## Test Quality Skills

### audit-react-test

**Read-only diagnostic.** Point it at a feature directory or a single spec file and it scores every test file against the 10 contract-first testing principles: public API only, boundary mocking, system isolation, strict strategies, data ownership, type-safe mocks, refactor sync, user outcomes, determinism, and total cleanup. Produces a per-file scorecard, violation inventory, coverage gap analysis, and migration priority list.

Run this before refactoring tests or after refactoring production code to identify stale mocks, missing cleanup, and coverage gaps.

```
/audit-react-test src/ui/page_blocks/dashboard/productivity
```

### build-react-test

Generate a contract-first test file for a component, container, hook, or utility. Reads the production file's API surface (props, return type, function signatures), selects the correct strategy (unit for DDAU components/pure functions, integration for containers), wires fixture data from `src/fixtures/`, and produces a spec that scores 10/10 on the audit skill.

Includes a delete threshold: if an existing spec file scores ≤ 4/10, mocks ≥ 3 own hooks, or references deleted providers, the skill deletes it and generates fresh rather than trying to salvage it.

```
/build-react-test src/ui/page_blocks/dashboard/productivity/ProductivityTrendCard.tsx
/build-react-test src/ui/services/hooks/queries/productivity/useProductivityQuery.ts
/build-react-test src/shared/utils/date/formatDate/formatDate.ts
```

### refactor-react-test

Audit an existing Vitest spec against the 10 contract-first principles and the current production API, then rewrite it to comply. Applies the delete threshold internally — if the file scores ≤ 4/10, deletes and delegates to `build-react-test` instead of patching. For files scoring 7+, applies targeted fixes: removes stale mocks, replaces internal mocking with boundary mocking, adds type safety to mock data, fixes cleanup, and rewrites implementation-detail assertions.

```
/refactor-react-test src/ui/page_blocks/dashboard/explorer/components/ExplorerEmptyStates.spec.tsx
/refactor-react-test src/ui/components/8flow/Table/tests/Table.spec.tsx
```

### refactor-playwright-test

Audit an existing Playwright E2E spec against the current page structure. Detects stale test IDs, hardcoded `waitForTimeout` calls (flakiness), missing route cleanup, redundant near-identical tests, and assertion anti-patterns. Fixes selectors, replaces waits with specific conditions, adds `page.unrouteAll()` cleanup, and consolidates repetitive tests into parameterized loops.

```
/refactor-playwright-test e2e/tests/mockDataRealTime.spec.ts
```

### build-playwright-test

Generate a Playwright E2E spec for a page route. Uses `page.route()` for network interception with fixture data from `src/fixtures/`, proper wait conditions (never `waitForTimeout`), and user-centric assertions via Playwright's auto-waiting matchers. Supports both mock-data tests (local mode) and real-auth tests.

```
/build-playwright-test /insights/productivity "Filter by team, verify table updates, drill down to user"
/build-playwright-test /insights/analysis/explorer "Load graph, click node, verify detail panel"
```

## Type Safety Skills

### audit-type-errors

**Read-only diagnostic.** Runs tsc, parses all errors, classifies each by root cause, identifies cascading error chains (one root cause producing N downstream errors), and produces a prioritized fix plan sorted by errors-eliminated-per-fix. Also checks for `any` concentrations, unsound type guards, trust boundary violations, duplicate type definitions, and non-null assertion hotspots.

```
/audit-type-errors ~/github/next-gen-atlassian
```

### Verification

Every skill (build and refactor) runs a verification step after writing code:

1. `npx tsc --noEmit` on the changed files (or the whole project if scoping is not practical). TypeScript errors in touched files must be fixed before finishing.
2. If the project has tests that cover the affected code, the skill runs them using the project's test runner. If no tests exist for the affected code, the skill reports that and moves on -- it does not skip type-checking.

The skill reports both results in its summary. A skill invocation is not complete until type-checking passes. Test failures must be fixed if tests exist; the absence of tests is noted but does not block.

## Customization

These skills encode conventions specific to a particular codebase (directory structure, hook naming, context patterns). To adapt them:

- **MAY-remain hooks list.** Each skill has an allowlist of hooks that leaf components may keep (useBreakpoints, useWindowSize, etc.). Edit this list to match your codebase's DOM/browser utility hooks.
- **Directory conventions.** The skills expect `services/hooks/queries/`, `services/hooks/mutations/`, `shared/hooks/`, and `containers/`. Update these paths if your project uses different conventions.
- **Context hook names.** The audit and route skills reference specific context hooks (useInsightsContext, useTeams, etc.) as examples. These are illustrative -- the skills detect any `useContext` or context consumer hook pattern.

## License

MIT
