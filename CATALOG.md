# Skill Catalog

Full descriptions of all available skills. Skills are auto-registered from
their directories; each skill's SKILL.md contains its full documentation.
This file is for browsing -- it is not loaded into conversation context.

## General Code Principles

These 10 principles apply to all non-trivial TypeScript code in the project -- utilities, server-side processing, API handlers, schemas, scripts, and shared libraries. The React-specific principles in the next section are specializations of these general rules applied to the component model.

### G1 -- Single Job Per Module

A file does one thing. A utility formats dates. A schema validates one endpoint's shape. A dataset loader fetches and transforms one dataset. If you need a second paragraph to explain what a file does, it is two files.

_Test: Can you name the file's job in under 8 words?_

### G2 -- Explicit Inputs, Explicit Outputs

Every function declares what it needs (parameters) and what it returns (typed return). No reaching into closures for data. No mutating arguments. No ambient dependencies (env vars, globals) without them being passed in or documented at the module top.

_Exception: Logger and config singletons at module scope are acceptable if declared at the top of the file._

### G3 -- Duplication Over Bad Abstraction

Two or three similar blocks of code are fine. Only extract a shared function when (a) the pattern has appeared 3+ times, (b) the shared shape is stable (not still evolving), and (c) the abstraction makes each call site simpler, not just shorter.

_Test: If the abstraction needs a boolean flag or mode parameter to handle the variants, it is probably two functions._

### G4 -- Low Cyclomatic Complexity

Keep branching shallow. Prefer early returns over nested if/else. Prefer lookup objects/maps over switch statements. Prefer guard clauses that exit early. Target: no function exceeds complexity of roughly 5 (one main path plus a few guards).

_Technique: "Flatten and return early."_

### G5 -- Parse, Don't Validate

Trust boundaries (API responses, user input, env vars, CSV rows) get parsed once into typed, branded values. After that point, code operates on trusted types -- no defensive re-checking. Interior code trusts its inputs.

_Aligns with the existing Zod-at-the-boundary pattern and branded types from `src/shared/types/brand.ts`._

### G6 -- Pure Core, Effects at the Edge

Separate computation from side effects. Data transformation functions should be pure (same input, same output, no I/O). Side effects (database calls, file writes, API requests, logging) happen in a thin outer layer that calls into pure functions.

_Benefits: testable without mocks, composable, predictable._

### G7 -- Narrow Exports

A module exports only what other modules consume. Internal helpers stay unexported. Barrel files (`index.ts`) are the public API. If you export something "just in case," delete it.

_Aligns with the existing cross-domain import rule._

### G8 -- Types as Documentation

The type signature should tell the full story. If someone needs to read the function body to understand the contract, the types are too loose. Use branded types, discriminated unions, and literal types to make invalid states unrepresentable.

_Corollary: Comments explain "why," types explain "what."_

### G9 -- Composition Over Configuration

Prefer composing small, focused functions (pipe, chain, sequence) over building one function that takes an options object. When you see `{ mode: 'A' | 'B', includeX?: boolean }`, consider whether that is really two separate functions.

_Ties directly into G3 -- a configurable abstraction is often a bad abstraction._

### G10 -- Fail Loud, Fail Fast

At trust boundaries, throw or return typed errors immediately. No silently swallowing. No fallback defaults that hide bugs. Interior code can assume valid data (because G5 already parsed it). When something unexpected happens, surface it -- do not paper over it.

## API Handler Principles

The following principles specialize G1-G10 for Next.js BFF API route handlers in `src/pages/api/`. Parse/Process/Respond is G5 + G6 applied to the HTTP lifecycle. Middleware composition is G9 applied to cross-cutting concerns. Error envelope is G10 applied to HTTP error responses.

Every API handler skill (`build-api-handler`, `refactor-api-handler`, `audit-api-handler`) enforces these rules.

### Parse/Process/Respond

Every handler follows a three-layer structure:

```
Request --> [Parse] --> [Process] --> [Respond] --> Response
             |              |              |
         Zod schemas    Pure logic    Validated output
```

- **Parse** (trust boundary): Every value from `req.body`, `req.query`, and dynamic route params passes through a Zod schema. No `as UserId`, `as TeamId`, or `as T` casts on request data. The parse layer produces typed, trusted values for the process layer. This is G5 applied to HTTP input.

- **Process** (business logic): Database queries and data transformation. For non-trivial logic (3+ branches, complex joins, data aggregation), extract to a co-located `.logic.ts` file where functions accept typed parameters and return typed values -- no `req`/`res` dependency. For simple CRUD (single query + response mapping), inline processing is acceptable. This is G6 applied to handler code.

- **Respond** (output boundary): The handler validates its output against the domain's Zod schema before returning. This catches shape drift between the DB layer and the client contract. This is G5 applied to HTTP output.

### Middleware composition

Every handler uses composed middleware in a fixed order:

```ts
export default withErrorHandler(withMethod(['GET'], withAuth(withRole(ROLES, handler))));
```

| Position      | Middleware         | Purpose                                           | When to use                  |
| ------------- | ------------------ | ------------------------------------------------- | ---------------------------- |
| 1 (outermost) | `withErrorHandler` | Catches thrown errors, maps to envelope           | Always                       |
| 2             | `withMethod`       | Rejects disallowed HTTP methods                   | Always                       |
| 3             | `withAuth`         | Verifies Firebase ID token, resolves user context | All non-public routes        |
| 4 (innermost) | `withRole`         | Checks caller roles against allowlist             | When specific roles required |

This is G9 -- each middleware does one job, they compose rather than one middleware with flags. The handler's only export is the default export (the composed chain).

### Co-located schema files

Zod schemas live next to the handler in `<handler>.schema.ts` (e.g., `index.schema.ts` for `index.ts`, `[id].schema.ts` for `[id].ts`). Import from `src/shared/types/` when the response shape matches a domain type. Handler-specific shapes (request body, query params) stay local.

Schema files contain:

- Request schemas (one per HTTP method if shapes differ)
- Route param schemas (for dynamic `[id]` routes, using `z.coerce`)
- Response schemas (imported from shared types when possible)
- Derived types via `z.infer`

Use branded type constructors in schema transforms where applicable (e.g., `z.string().transform(UserId)`).

### Error envelope pattern

Throw typed error classes instead of raw `res.status(N).json()`:

```ts
// Wrong
if (!user) return res.status(404).json({ error: 'User not found' });

// Right
if (!user) throw new NotFoundError('User');
```

Error classes (`NotFoundError`, `BadRequestError`, `ConflictError`, `ForbiddenError`) live in `src/server/errors/ApiErrorResponse.ts`. `withErrorHandler` catches them and maps to HTTP status codes and the envelope format. This is G10 -- errors surface at boundaries, handler code reads like business logic.

### Multi-tenancy scoping

All DB queries are scoped to `ctx.organizationId`. No handler serves data across organization boundaries unless explicitly designed as an internal/admin route with appropriate role checks.

### Pure-core extraction threshold

| Condition                                           | Action                              |
| --------------------------------------------------- | ----------------------------------- |
| Single CRUD operation, handler body under ~50 lines | Inline in handler                   |
| 3+ database queries with conditional branching      | Extract to `.logic.ts`              |
| Data transformation independently testable          | Extract to `.logic.ts`              |
| CC would exceed 10 without extraction               | Extract to `.logic.ts`              |
| Same logic needed by multiple handlers              | Extract to shared `src/server/lib/` |

Extracted functions accept typed parameters and return typed values. They throw error classes for business rule violations. Pure data transformation functions (no DB access) are separate from I/O functions.

### Complexity targets

Every function in a handler must have cyclomatic complexity <= 10. Target CC <= 5. Multi-method handlers split into per-method functions (`handleGet`, `handlePost`). `ast-complexity` is run on every generated or refactored handler.

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

Shared types live in `src/shared/types/<domain>/index.ts` (or `<domain>/schemas.ts` + `<domain>/types.ts` for larger domains). Each domain module is the single source of truth for that domain's type definitions and Zod schemas. Types are derived from Zod schemas via `z.infer<>`. Before defining a new interface, check whether one already exists in `src/shared/types/`. If an existing definition is close but not exact, extend or narrow it with `Pick`/`Omit`/`&` rather than duplicating. See `docs/type-schema-unification.md` for the full architecture.

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

**Storage access must go through `typedStorage`.** Never call `localStorage.getItem`/`setItem`/`removeItem` or `sessionStorage.*` directly in production code. Use `readStorage`/`writeStorage`/`removeStorage` from `@/shared/utils/typedStorage`. Every `readStorage` call requires a Zod schema, enforcing runtime validation at the trust boundary automatically. `writeStorage` handles `JSON.stringify`; `readStorage` handles `JSON.parse` + schema validation. Each storage key has exactly one owner module that exports the key constant and its Zod schema.

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

Both **Persistent** and **Ephemeral** tiers must be accessed exclusively through `readStorage`/`writeStorage`/`removeStorage` from `@/shared/utils/typedStorage`. Pass `'session'` as the third argument for sessionStorage; localStorage is the default. Never call raw `localStorage.*` or `sessionStorage.*` in production code.

sessionStorage for ephemeral drill-down state is not a DDAU violation. It is external-system sync (same category as ResizeObserver or scroll position) -- the container or inner container that owns the drill-down state is the appropriate owner of the storage read/write, using the typedStorage helpers.

**Why not session storage for filters?** Route-shaping state (what a page shows) must be inspectable. Session storage is invisible in the URL bar, invisible in shared links, and invisible in bug reports. It creates version skew when app updates leave stale keys behind, and the fix becomes "clear storage" -- an unacceptable failure mode. Worse, mixing URL params and session storage for the same state domain forces a precedence rule (which source wins?) that is hidden from users and hard to test. One state channel with one policy surface is simpler than two channels with reconciliation.

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
/audit-module src/server/middleware/withAuth.ts
```

### refactor-module

Takes a non-React TypeScript file and rewrites it to comply with G1-G10. Splits mixed-responsibility files, extracts pure functions from side-effectful ones, replaces nested branching with early returns and lookup maps, narrows exports, adds branded types at trust boundaries, and flags (but does not remove) duplication that might be intentional.

```
/refactor-module src/shared/utils/date/formatDate.ts
/refactor-module src/server/errors/ApiErrorResponse.ts
```

### audit-api-handler

**Read-only diagnostic.** Audits an API route handler together with its `.schema.ts` file. Checks schema completeness (request params, response shape, error responses), handler structure (parse at boundary, pure logic in middle, response at edge), consistent error handling patterns, and Zod schema alignment with the shared type system.

```
/audit-api-handler src/pages/api/users/user-data.ts
```

### refactor-api-handler

Takes an existing API route handler and rewrites it to comply with G1-G10 plus handler-specific rules (schema completeness, parse/process/respond structure, middleware composition, error envelope). Extracts pure business logic to a `.logic.ts` file, adds or completes Zod schemas in a co-located `.schema.ts` file, normalizes error handling to typed error classes, and reports mandatory before/after cyclomatic complexity scores.

Run `audit-api-handler` first for a prioritized refactor checklist.

```
/refactor-api-handler src/pages/api/users/user-data.ts
/refactor-api-handler src/pages/api/users/update.ts
```

### build-api-handler

Generates a new Next.js BFF API route handler with co-located schema, middleware composition, and optional pure-core extraction. Produces the handler file, Zod schema file, optional business logic module, and unit test. Enforces G4 complexity limits (CC <= 10) and G5 parse-at-boundary with AST verification.

```
/build-api-handler /api/users/teams GET,POST List and create teams for an organization
/build-api-handler /api/users/teams/[id] PUT Update a team by ID
```

### build-module

Generates a new non-React TypeScript module (utility, transformer, validator, data processor) following G1-G10 principles. Surveys the codebase for duplicates and conventions, designs the public API surface, generates the module file with barrel export and test file, and verifies with `tsc`, AST complexity, AST type safety, and `vitest run`.

```
/build-module formatDuration -- format a number of seconds into human-readable duration strings
/build-module rankOpportunities -- score and rank automation opportunities by estimated savings
```

### audit-module-test

**Read-only diagnostic.** Audits test files for non-React modules against the 10 contract-first testing principles adapted for utilities, server processors, and data transformers. Detects internal mocking, stale mocks, missing cleanup, type-unsafe mocks, and non-determinism. Produces a per-file scorecard and migration priority list.

```
/audit-module-test src/server/middleware/withAuth.spec.ts
/audit-module-test src/shared/utils/
```

### build-module-test

Generates a test file for a non-React module. Reads the production API surface, classifies exports as pure or I/O, selects the correct strategy (zero mocks for pure, boundary mocks for I/O), wires fixture data, and produces a spec that scores 10/10 on `audit-module-test`. Includes a delete threshold for existing specs that are beyond repair.

```
/build-module-test src/pages/api/users/user-data.ts
/build-module-test src/shared/utils/date/formatDate.ts
```

### refactor-module-test

Audits an existing test file for a non-React module against the 10 principles and the current production API, then rewrites it to comply. Applies the delete threshold -- if the file scores <= 4/10, deletes and delegates to `build-module-test`. For files scoring 7+, applies targeted fixes: removes internal mocks, adds type safety, fixes cleanup, rewrites implementation-detail assertions.

```
/refactor-module-test src/shared/utils/metadata.spec.ts
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
/build-react-service-hook useTeamProductivityQuery GET /api/users/data-api/productivity/getTeamProductivity
```

### build-react-component

Generates a new DDAU React component. Receives all data via props and fires actions via callbacks. Creates the component file, barrel export, types file (if needed), and test skeleton.

```
/build-react-component ProductivityCard "Card showing productivity score with trend indicator"
```

### build-react-hook

Generates a new DOM utility or state utility hook. Not for data-fetching -- redirects to `build-react-service-hook` for useQuery/useMutation.

```
/build-react-hook useScrollToTop "scrolls to top of page on route change"
```

### build-react-route

Generates a new route page file with a DDAU container. Creates the thin Next.js page (default export), a container that owns all hooks, and wires them together.

```
/build-react-route /insights/team-productivity "Team productivity dashboard with filters"
```

### build-react-provider

Generates a new scoped context provider (`XxxScopeProvider`) that holds narrow, stable UI state. Validates against escape-hatch criteria before generating. No data-fetching, no toasts, no navigation.

```
/build-react-provider DrillDownScope "{ selectedSystemId: SystemId | null, setSelectedSystemId }"
```

### build-react-test

Generate a contract-first test file for a component, container, hook, or utility. Reads the production file's API surface, selects the correct strategy, wires fixture data, and produces a spec that scores 10/10 on the audit skill.

```
/build-react-test src/ui/page_blocks/dashboard/productivity/ProductivityTrendCard.tsx
/build-react-test src/ui/services/hooks/queries/productivity/useProductivityQuery.ts
```

### migrate-page-to-ssr

Migrates a Next.js page from client-side-only data fetching to server-side rendering via `getServerSideProps`. Extracts server fetchers, seeds TanStack Query cache, preserves DDAU and fixture system.

```
/migrate-page-to-ssr src/pages/insights/user-productivity.tsx
```

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

## Observability Skills

These skills audit, build, and refactor New Relic integration across the client (NREUM browser agent) and server (Node.js APM).

### audit-nr-observability

**Read-only diagnostic.** Audits New Relic integration gaps across both client and server using `ast-nr-client`, `ast-nr-server`, and `ast-error-flow` AST tools. Produces a gap list showing where NR should be called but is not, classified by severity (CRITICAL/HIGH/MEDIUM/LOW).

Run this before implementing NR integration or after adding new error handling to verify coverage.

```
/audit-nr-observability
/audit-nr-observability src/server/
```

### build-nr-client-integration

Implements client-side NR browser agent gaps. Each gap ID (C1-C5) maps to a specific integration point: global error listeners, user ID custom attributes, auth page naming, web vitals reporting, and custom performance marks.

```
/build-nr-client-integration C1
/build-nr-client-integration C1 C2 C4
```

### build-nr-server-integration

Implements server-side NR APM gaps. Gap IDs (S1-S6) cover: installing the newrelic package, creating config, adding noticeError to middleware, setting custom attributes in auth, and wrapping ClickHouse queries in custom segments. S1 and S2 are prerequisites for all other server gaps.

```
/build-nr-server-integration S1 S2
/build-nr-server-integration S3 S4
```

### refactor-error-handler

Refactors catch blocks to add NR error reporting alongside existing `console.error` calls. Uses `ast-error-flow` to identify console-only sinks, then adds the appropriate NR reporting call (client: `reportErrorToNewRelic`, server: `newrelic.noticeError`). Additive only -- does not remove existing console logging.

```
/refactor-error-handler src/server/middleware/
/refactor-error-handler src/ui/providers/
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

Includes a delete threshold: if an existing spec file scores <= 4/10, mocks >= 3 own hooks, or references deleted providers, the skill deletes it and generates fresh rather than trying to salvage it.

```
/build-react-test src/ui/page_blocks/dashboard/productivity/ProductivityTrendCard.tsx
/build-react-test src/ui/services/hooks/queries/productivity/useProductivityQuery.ts
/build-react-test src/shared/utils/date/formatDate/formatDate.ts
```

### refactor-react-test

Audit an existing Vitest spec against the 10 contract-first principles and the current production API, then rewrite it to comply. Applies the delete threshold internally -- if the file scores <= 4/10, deletes and delegates to `build-react-test` instead of patching. For files scoring 7+, applies targeted fixes: removes stale mocks, replaces internal mocking with boundary mocking, adds type safety to mock data, fixes cleanup, and rewrites implementation-detail assertions.

```
/refactor-react-test src/ui/page_blocks/dashboard/explorer/components/ExplorerEmptyStates.spec.tsx
/refactor-react-test src/ui/components/8flow/Table/tests/Table.spec.tsx
```

### refactor-playwright-test

Audit an existing Playwright E2E spec against the current page structure. Detects stale test IDs, hardcoded `waitForTimeout` calls (flakiness), missing route cleanup, redundant near-identical tests, and assertion anti-patterns. Fixes selectors, replaces waits with specific conditions, adds `page.unrouteAll()` cleanup, and consolidates repetitive tests into parameterized loops.

```
/refactor-playwright-test integration/tests/mockDataRealTime.spec.ts
```

### build-playwright-test

Generate a Playwright E2E spec for a page route. Uses `page.route()` for network interception with fixture data from `src/fixtures/`, proper wait conditions (never `waitForTimeout`), and user-centric assertions via Playwright's auto-waiting matchers. Supports both mock-data tests (fixture-backed via page.route()) and real-auth tests.

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

#### Playwright integration test runs: minimum scope only

The full Playwright suite (~178 tests) takes ~20 minutes without coverage (~25 minutes with V8 coverage). Never run the full suite as a verification step. Always run the minimum set of tests that covers the changed code:

| What changed                                                                                | What to run                                                             |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A single spec file                                                                          | `bash scripts/run-integration.sh spec integration/tests/<file>.spec.ts` |
| Tests matching a name                                                                       | `bash scripts/run-integration.sh grep "<pattern>"`                      |
| CRUD specs (users+teams, assignments+url-classification+bpo+projects)                       | `bash scripts/run-integration.sh crud`                                  |
| Insight specs in batch A (systems, microworkflows, user-productivity with server restarts)  | `bash scripts/run-integration.sh insights-a`                            |
| Insight specs in batch B (relays, favorites, navigation, usage)                             | `bash scripts/run-integration.sh insights-b`                            |
| Insight specs in batch C (realtime, auth, team-productivity, components, operational-hours) | `bash scripts/run-integration.sh insights-c`                            |
| Cross-cutting change (mock handler, fixture system, POM, config)                            | `bash scripts/run-integration.sh` (full suite, only when necessary)     |

The chunked runner (`scripts/run-integration.sh`) restarts the Next.js server between chunks to prevent server degradation. CRUD is split into two sub-chunks (CRUD-1: users+teams, CRUD-2: assignments+url-classification+bpo+projects) with a server restart between them. Insights-A is split into four sub-chunks (A1/A2/A3a/A3b) with server restarts between them. Insights chunks run with parallel workers (3 normal, 2 in coverage mode); CRUD runs serial due to shared mock state. See the script header for full usage.

## Orchestration Skills

These skills coordinate multi-prompt work sessions. They generate plans, create prompt sequences, run work agents, and verify results. Use them when a task spans 3+ files across different domains, requires phased implementation, or has ordering dependencies.

Orchestration skills do not write production code. They generate the plan and prompts, then run work agents (via Task tool or manually) to execute each prompt. After each prompt, the orchestrator verifies the results independently before moving on.

### How it works

1. You invoke the skill with a description of the work
2. The skill reads the codebase, generates a master plan and prompt sequence in `$PLANS_DIR/`
3. The skill enters the orchestrator loop: runs one prompt at a time, verifies output, gates on quality
4. After all prompts complete, the orchestrator generates a cleanup prompt from issues discovered during execution
5. You review and approve the cleanup prompt before it runs
6. Final verification and plan update

### Auto vs. manual mode

By default, the orchestrator runs work agents automatically via the Task tool. This works well for mechanical, well-scoped prompts (pattern replacement, dead code deletion, import path migration).

For prompts that require judgment, touch many files, or involve complex refactoring, say "manual" or "I'll run this one." The orchestrator outputs the prompt text; you run it in a separate conversation where the work agent has a full context window and can ask follow-up questions. Manual mode is the common choice for non-trivial prompts.

### The cleanup prompt

Work agents stay focused on their assigned task. When they discover issues outside scope, they append them to a cleanup file instead of fixing them in place. After all planned prompts complete, the orchestrator reads the cleanup file and generates a final cleanup prompt. You review it before execution. This keeps work agents on task while ensuring nothing gets lost.

### Sync skills for embedded reference data

Any skill that embeds codebase reference data (navigation structure, roles, tabs, endpoint inventories, type lists, question option lists) needs a companion sync skill that audits the embedded data against the current codebase and regenerates it. Without a sync skill, the embedded data drifts silently as PRs land, and the skill starts generating code that references stale names, missing endpoints, or deleted types.

Run the sync skill after any PR that changes the data the skill references. Currently `sync-orchestrate-poc` is the only sync skill. If you create a new skill that embeds codebase-specific reference data, create a companion `sync-<skill-name>` skill alongside it.

### orchestrate-bug-fix

Coordinates a multi-file bug fix. You describe the bug; the skill investigates the codebase, identifies affected files, generates targeted fix prompts with verification commands, and runs them in sequence.

```
/orchestrate-bug-fix Row selection desyncs from URL state when using browser back button on systems page
```

### orchestrate-feature

Coordinates phased implementation of a new feature. You describe the feature; the skill designs the implementation phases, identifies dependencies between them, generates prompts in topological order, and runs them.

```
/orchestrate-feature Add CSV export to all dashboard pages with column filtering and date range in filename
```

### orchestrate-audit-fixes

Coordinates fixes for audit findings. You provide the audit report path or describe what to audit; the skill triages findings by severity and domain, groups them into fix prompts, and runs them in priority order.

```
/orchestrate-audit-fixes path/to/audit-report.md
```

### orchestrate-backlog

Coordinates a backlog of accumulated items. You provide a backlog file or describe the items; the skill prioritizes, identifies dependencies, sequences prompts, and runs them.

```
/orchestrate-backlog $PLANS_DIR/uf-backlog.md
```

### orchestrate-migration

Coordinates a multi-phase migration. You describe what is being migrated; the skill inventories the current state, plans migration phases, generates prompts, and runs them.

```
/orchestrate-migration Migrate all integration tests from SSO authentication to Firebase emulator
/orchestrate-migration Replace all raw localStorage calls with typedStorage
```

### orchestrate-poc

Interactive wizard that guides a product manager through building a PoC dashboard feature. Asks structured questions about placement, data, UX, and permissions, then generates a filled-in PRD and implementation prompts. Understands the full dashboard structure, BFF architecture, and fixture system so it can present meaningful choices and identify data gaps that require BFF team coordination.

```
/orchestrate-poc Show team utilization rates broken down by system and time period
/orchestrate-poc Add a page that shows automation opportunity scores per workstream
```

### iterate-poc

Iterates on an existing PoC created via orchestrate-poc. The PM describes the desired change in the prompt (no full questionnaire). The skill reads the PRD and affected code, performs an impact analysis, generates targeted implementation prompts, executes them via work agents, verifies, and updates the PRD. Handles cosmetic, structural, data-extending, and cross-boundary changes with appropriate prompt counts and skill selection.

```
/iterate-poc team-utilization add a column to the table showing total hours
/iterate-poc system-efficiency swap the bar chart for a line chart and add a date range filter
```

### iterate-poc-prd

Iterates on the post-hoc PRD produced by orchestrate-poc. Takes stakeholder or engineering feedback, updates the PRD in-place with a changelog entry, checks that the updated PRD still matches the actual code, and flags divergences where the PRD now implies code changes the PoC does not have. Recommends iterate-poc if code changes are needed -- does not modify code itself.

```
/iterate-poc-prd team-utilization the VP said we need to show cost savings not just time savings
/iterate-poc-prd system-efficiency rename utilization to capacity everywhere and cut the export feature for v1
```

### generate-handoff-tickets

Reads the artifacts produced by orchestrate-poc (PRD, BFF handoff doc, cleanup file, escalation report) and creates the standard Jira ticket set for the PoC-to-production handoff: feature epic, eng code review, QE test plan, BFF migration, database changes, per-environment deployments, feature flag cleanup, and PoC decommission. Requires the Atlassian Jira MCP server to be configured.

```
/generate-handoff-tickets team-utilization
/generate-handoff-tickets system-efficiency
```

### sync-orchestrate-poc

Audits the orchestrate-poc skill against the current codebase and regenerates all embedded reference data -- navigation hierarchy, roles, tabs, mock endpoints, shared types, branded types, and question option lists. Run after any PR that adds/removes dashboard tabs, feature flags, roles, shared types, mock endpoints, or fixture domains.

```
/sync-orchestrate-poc
```

### document-bff-requirements

Generates BFF requirements documentation for a PoC feature branch. Uses `ast-bff-gaps` to mechanically extract endpoint gap data (BFF stubs returning 501, mock routes, missing BFF routes) and produces a structured markdown section for `docs/upcoming-poc-features-needing-bff-work.md`. Sections that require domain knowledge (ClickHouse queries, frontend changes) are marked with `[FILL IN]` placeholders. Run after completing a PoC prompt sequence that added mock routes and BFF stubs.

```
/document-bff-requirements sd/nga-systems-port "NGA Systems Port" src/pages/api/users/data-api/systems/
```

### validate-plan

Validates an orchestration plan after pre-flight certification but before execution. Auto-invoked by all orchestrate-\* skills at Step 8. Runs a mandatory multi-layer validation:

1. Conditional dialectic check (blended >= 5.0 or new architecture)
2. Adversarial plan review (always, not conditional on score)
3. Deep review (verify import paths, file paths, API signatures, and constants in every prompt against the actual codebase using AST tools)
4. PoC gate (adversarial review surfaces risky approaches; user decides whether to validate with a throwaway test)
5. Prework checklist (calibration fixtures, debt file, branch, baseline)

Produces a verdict: READY FOR EXECUTION or BLOCKED.

```
/validate-plan ~/plans/authz-enforcement.md
```

### archive-plan

Archives a completed orchestration plan. Auto-invoked by all orchestrate-\* skills at Step 12. Handles all post-plan protocol steps that were previously documented as prose in `plans/CLAUDE.md` and relied on agent memory:

1. Collect execution metrics (git + session DB)
2. Post-execution calibration (compare predicted F/C against actuals, adjust and tag if divergent, create feedback fixture if plan audit interpreter was wrong)
3. Handle cleanup file items (move to backlog or KNOWN-DEBT)
4. Archive files (move plan + cleanup, gzip prompts into tarball)
5. Update historical-reference.md (scoring table, execution metrics, reasoning entry, F/C anchor tables)
6. Update active plans table
7. Cross-repo updates
8. Commit and push

```
/archive-plan authz-enforcement
```

## Verification Recording Skills

Record browser-driven demonstrations of bug fixes for QE review or Jira attachment. Both skills drive the browser through a scripted sequence and produce a visual artifact.

### record-verification-gif

Record an animated GIF by capturing Playwright MCP screenshots at each step and stitching them with ffmpeg. Uses `mcp__playwright__browser_run_code` for batch capture (single Playwright call, not per-frame MCP round-trips). Output is a looping GIF at 12fps. Supports `--attach <JIRA-KEY>` to attach directly to a ticket.

```
/record-verification-gif AV-6305 -- shrink viewport, verify sidebar hides
/record-verification-gif AV-1234 --attach AV-1234 --output ~/Desktop/demo.gif
```

### record-verification-webm

Record a WebM video using `playwright-cli` native video recording (`video-start`/`video-stop`). Produces continuous-frame WebM video (not screenshot-stitched). Requires `@playwright/cli` (`npm install -g @playwright/cli`). Supports `--attach <JIRA-KEY>`.

```
/record-verification-webm AV-6305 -- shrink viewport, verify sidebar hides
/record-verification-webm AV-1234 --attach AV-1234 --output ~/Desktop/demo.webm
```

Key differences:

| | GIF | WebM |
|---|---|---|
| Tool | Playwright MCP + ffmpeg | playwright-cli native |
| Output | Animated GIF (looping) | WebM video |
| Motion | Discrete frames | Continuous |
| Best for | Step-by-step verification | Smooth transitions, animations |

## Decision Skills

These skills help with thinking, not coding. They do not write files or modify code. Use them when you are stuck, need to evaluate options, or want structured brainstorming.

### dialectic

Adversarial brainstorming. Launches two sub-agents in parallel -- an Ideas agent (generative, optimistic: solutions, approaches, tradeoffs, alternatives) and a Critical agent (skeptical, rigorous: feasibility, complexity, maintenance burden, architectural fit). The Arbiter evaluates every idea against the critique framework, checks for novel options that emerge from the collision, and categorizes everything into three sets: DOING (actionable now), DEFERRED (blocked by a concrete condition), and REJECTED (killed by a specific constraint or poor effort/value ratio).

Output is structured and inline -- no files created.

```
/dialectic I need to add real-time updates to the dashboard but I'm stuck on the architecture
/dialectic What's the right way to handle cross-domain cache invalidation after mutations
/dialectic We need better error handling but I don't know where to start
```

## AST Tools

Skills use static analysis tools in `scripts/AST/` instead of grep for code structure queries. Each skill's Step 0 lists the specific tools to run. See `scripts/AST/CLAUDE.md` for the full tool inventory and the AST-first policy.

**Tool hierarchy (strict).** Use the highest-tier tool that covers your query. Never use a lower-tier tool when a higher-tier tool handles the pattern.

| Tier | Tool                               | Use for                                            | Examples                                                                                                         |
| ---- | ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | AST tools (`scripts/AST/ast-*.ts`) | Domains with purpose-built analyzers               | `ast-imports` for import graph, `ast-complexity` for cyclomatic complexity, `ast-type-safety` for cast detection |
| 2    | `sg` (ast-grep) via Bash           | Structural code patterns with no AST tool          | `sg -p 'createColumnHelper()' src/`, `sg -p 'useHookName($$$)' src/`                                             |
| 3    | `rg` (ripgrep) via Bash            | Non-code text (docs, plans, config, SQL, SKILL.md) | Config values, string literals, markdown content                                                                 |

**Do NOT use the Grep tool** (the Claude Code built-in) for TypeScript source code. The Grep tool bypasses the tool hierarchy -- agents default to it because it is convenient, skipping the AST tools entirely. For TS/TSX files in `src/`, `integration/`, and `scripts/`, use AST tools (Tier 1) or `sg`/`rg` via Bash (Tier 2-3). The Grep tool is acceptable only for non-code files (docs, plans, markdown, JSON, SQL, SKILL.md).

**AST tool lookup.** Before reaching for `rg` or `sg` on TypeScript source, check whether an AST tool handles the query:

| Query type                         | AST tool                                   | CLI example                                                     |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------- |
| "Where is `FooBar` used/imported?" | `ast-imports`                              | `npx tsx scripts/AST/ast-query.ts imports src/ --pretty`              |
| "Who exports X? Dead exports?"     | `ast-query dead-exports`                   | `npx tsx scripts/AST/ast-query.ts dead-exports src/ --pretty`   |
| "Where is `useMyHook` called?"     | `ast-react-inventory`                      | `npx tsx scripts/AST/ast-query.ts hooks src/path/ --pretty` |
| "Any `as any` or `!` assertions?"  | `ast-type-safety`                          | `npx tsx scripts/AST/ast-query.ts type-safety src/path/ --pretty`     |
| "What does this useEffect do?"     | `ast-interpret-effects`                    | Classifies each useEffect                                       |
| "How is X mocked in tests?"        | `ast-test-analysis --test-files`           | Mock patterns, cleanup gaps                                     |
| "Cyclomatic complexity?"           | `ast-complexity`                           | Per-function CC scores                                          |
| "Circular dependencies?"           | `ast-query circular`                       | `npx tsx scripts/AST/ast-query.ts circular src/ --pretty`       |
| "Which files import symbol X?"     | `ast-query symbol`                         | `npx tsx scripts/AST/ast-query.ts symbol BadRequestError src/ --pretty` |
| "Where is field `foo` used?"       | `ast-field-refs --field <name>`            | `ast-field-refs src/ --field active_time_ms --pretty`           |

**Gap-flagging (mandatory).** When using `sg` OR `rg` on TypeScript source because no AST tool covers the pattern, append an entry to `scripts/AST/GAPS.md`. This applies to BOTH Tier 2 and Tier 3. One row per pattern class, not per invocation. Before reaching for `sg` or `rg`, check GAPS.md -- if the pattern has a `filled` entry, use that AST tool instead. Use `/build-ast-tool` to fill gaps from the registry.

### Three-layer architecture

The AST tools follow a three-layer architecture that separates detection from interpretation from reporting:

| Layer             | What it does                                  | Output                                                         | Examples                                                          |
| ----------------- | --------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Observations**  | Extract line-anchored structural facts        | `Observation` objects with `kind`, `file`, `line`, `evidence`  | `HOOK_CALL`, `JSX_TERNARY_CHAIN`, `MOCK_DECLARATION`              |
| **Assessments**   | Interpret observations against repo config    | `Assessment` objects with `confidence`, `rationale`, `basedOn` | `LIKELY_SERVICE_HOOK`, `DERIVED_STATE`, `MOCK_INTERNAL_VIOLATION` |
| **Report Policy** | Present findings with severity and escalation | Skill-specific formatting, `[AST-confirmed]` tags              | Violation tables, migration checklists                            |

**Layer 1: Observations.** Pure extracted structure. Line-anchored, objective, no classifications or judgments. Every observation has a `kind` (what was found), `file` and `line` (where), and `evidence` (structured details). Observations never say "this is a service hook" -- they say "this function call named `useTeamQuery` imports from `services/hooks/queries/team`."

**Layer 2: Assessments.** Interpretations over observations plus repo config (`ast-config.ts`). Every assessment has `confidence` (high/medium/low), `rationale` (why this classification), `basedOn` (which observations), and `requiresManualReview` (whether automation should pause). Assessments answer "is this a violation?" and "how confident are we?"

**Layer 3: Report Policy.** Owned by skills, not tools. Skills decide when to mark `[AST-confirmed]` (high confidence, based on direct observations), when to bump severity, when to force manual confirmation, and when to suppress weak candidates.

**Calibration.** A feedback loop that measures interpreter accuracy against fixture ground truth and tunes config. Not a fourth layer (it operates on the interpreter layer) but a lifecycle process: interpreters emit assessments, refactor/test skills create feedback fixtures when they encounter misclassifications, and the `/calibrate-ast-interpreter` skill consumes pending fixtures in batches (3+). The skill follows a diagnostic-first approach: it checks for algorithmic defects (hard ceilings, double-counting, observer gaps) before tuning weights in `ast-config.ts`. See `scripts/AST/ground-truth/` for the fixture corpus and `scripts/AST/docs/ast-calibration.md` for accuracy baselines and calibration history.

### Tool inventory

| Tool                  | Observations emitted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Interpreter                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ast-imports`         | `STATIC_IMPORT`, `DYNAMIC_IMPORT`, `EXPORT_DECLARATION`, `CIRCULAR_DEPENDENCY`, `DEAD_EXPORT_CANDIDATE`                                                                                                                                                                                                                                                                                                                                                                                                        | `ast-interpret-dead-code`                                                 |
| `ast-react-inventory` | `HOOK_CALL`, `EFFECT_LOCATION`, `EFFECT_*`, `COMPONENT_DECLARATION`, `PROP_FIELD`                                                                                                                                                                                                                                                                                                                                                                                                                              | `ast-interpret-effects`, `ast-interpret-hooks`, `ast-interpret-ownership` |
| `ast-jsx-analysis`    | `JSX_TERNARY_CHAIN`, `JSX_GUARD_CHAIN`, `JSX_TRANSFORM_CHAIN`, `JSX_IIFE`, `JSX_INLINE_HANDLER`, `JSX_RETURN_BLOCK`                                                                                                                                                                                                                                                                                                                                                                                            | `ast-interpret-template`                                                  |
| `ast-test-analysis`   | `MOCK_DECLARATION`, `ASSERTION_CALL`, `RENDER_CALL`, `CLEANUP_CALL`, `FIXTURE_IMPORT`                                                                                                                                                                                                                                                                                                                                                                                                                          | `ast-interpret-test-quality`                                              |
| `ast-complexity`      | `FUNCTION_COMPLEXITY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | (observation-only)                                                        |
| `ast-data-layer`      | `QUERY_HOOK_DEFINITION`, `MUTATION_HOOK_DEFINITION`, `FETCH_API_CALL`, `QUERY_KEY_FACTORY`                                                                                                                                                                                                                                                                                                                                                                                                                     | (observation-only)                                                        |
| `ast-side-effects`    | `CONSOLE_CALL`, `TOAST_CALL`, `TIMER_CALL`, `POSTHOG_CALL`, `WINDOW_MUTATION`                                                                                                                                                                                                                                                                                                                                                                                                                                  | (observation-only)                                                        |
| `ast-storage-access`  | `DIRECT_STORAGE_CALL`, `TYPED_STORAGE_CALL`, `JSON_PARSE_CALL`, `COOKIE_CALL`                                                                                                                                                                                                                                                                                                                                                                                                                                  | (observation-only)                                                        |
| `ast-env-access`      | `PROCESS_ENV_ACCESS`, `ENV_WRAPPER_ACCESS`, `ENV_WRAPPER_IMPORT`                                                                                                                                                                                                                                                                                                                                                                                                                                               | (observation-only)                                                        |
| `ast-feature-flags`   | `FLAG_HOOK_CALL`, `FLAG_READ`, `PAGE_GUARD`, `CONDITIONAL_RENDER`                                                                                                                                                                                                                                                                                                                                                                                                                                              | (observation-only)                                                        |
| `ast-type-safety`     | `AS_ANY_CAST`, `NON_NULL_ASSERTION`, `TS_DIRECTIVE`, `TRUST_BOUNDARY_CAST`                                                                                                                                                                                                                                                                                                                                                                                                                                     | (observation-only)                                                        |
| `ast-pw-test-parity`  | `PW_TEST_BLOCK`, `PW_ASSERTION`, `PW_ROUTE_INTERCEPT`, `PW_NAVIGATION`, `PW_POM_USAGE`, `PW_AUTH_CALL`, `PW_SERIAL_MODE`, `PW_BEFORE_EACH`                                                                                                                                                                                                                                                                                                                                                                     | `ast-interpret-pw-test-parity`                                            |
| `ast-refactor-intent` | `INTENT_SIGNAL_BEFORE`, `INTENT_SIGNAL_AFTER`, `INTENT_SIGNAL_PAIR`                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ast-interpret-refactor-intent`                                           |
| `ast-bff-gaps`        | `BFF_STUB_ROUTE`, `MOCK_ROUTE`, `BFF_MISSING_ROUTE`, `QUERY_HOOK_BFF_GAP`                                                                                                                                                                                                                                                                                                                                                                                                                                      | (observation-only)                                                        |
| `ast-branded-check`   | `UNBRANDED_ID_FIELD`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | (observation-only)                                                        |
| `ast-authz-audit`     | `RAW_ROLE_CHECK`, `RAW_ROLE_EQUALITY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | (observation-only)                                                        |
| `ast-vitest-parity`   | `VT_DESCRIBE_BLOCK`, `VT_TEST_BLOCK`, `VT_ASSERTION`, `VT_MOCK_DECLARATION`, `VT_RENDER_CALL`, `VT_FIXTURE_IMPORT`, `VT_BEFORE_EACH`, `VT_AFTER_EACH`                                                                                                                                                                                                                                                                                                                                                          | `ast-interpret-vitest-parity`                                             |
| `ast-error-coverage`  | `QUERY_ERROR_HANDLED`, `QUERY_ERROR_UNHANDLED`, `MUTATION_ERROR_HANDLED`, `MUTATION_ERROR_UNHANDLED`, `GLOBAL_ERROR_HANDLER`                                                                                                                                                                                                                                                                                                                                                                                   | (observation-only)                                                        |
| `ast-concern-matrix`  | `CONTAINER_HANDLES_LOADING`, `CONTAINER_HANDLES_ERROR`, `CONTAINER_HANDLES_EMPTY`, `CONTAINER_HANDLES_PERMISSION`, `CONTAINER_MISSING_LOADING`, `CONTAINER_MISSING_ERROR`, `CONTAINER_MISSING_EMPTY`, `CONTAINER_MISSING_PERMISSION`                                                                                                                                                                                                                                                                           | (observation-only)                                                        |
| `ast-export-surface`  | `EXPORT_SURFACE`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | (observation-only)                                                        |
| `ast-plan-audit`      | `PLAN_HEADER_MISSING`, `PLAN_HEADER_INVALID`, `VERIFICATION_BLOCK_MISSING`, `CLEANUP_FILE_MISSING`, `PROMPT_FILE_MISSING`, `PROMPT_VERIFICATION_MISSING`, `PROMPT_DEPENDENCY_CYCLE`, `PROMPT_MODE_UNSET`, `STANDING_ELEMENT_MISSING`, `RECONCILIATION_TEMPLATE_MISSING`, `PRE_FLIGHT_CERTIFIED`, `PRE_FLIGHT_CONDITIONAL`, `PRE_FLIGHT_BLOCKED`, `PRE_FLIGHT_MARK_MISSING`, `NAMING_CONVENTION_INSTRUCTION`, `CLIENT_SIDE_AGGREGATION`, `DEFERRED_CLEANUP_REFERENCE`, `FILE_PATH_REFERENCE`, `SKILL_REFERENCE` | (observation-only, MDAST-based)                                           |
| `ast-skill-analysis`  | `SKILL_SECTION`, `SKILL_STEP`, `SKILL_SECTION_ROLE`, `SKILL_CODE_BLOCK`, `SKILL_COMMAND_REF`, `SKILL_FILE_PATH_REF`, `SKILL_CROSS_REF`, `SKILL_DOC_REF`, `SKILL_TABLE`, `SKILL_CHECKLIST_ITEM`, `SKILL_SUPERSEDED_PATTERN`, `SKILL_MISSING_CONVENTION`, `SKILL_CONVENTION_ALIGNED`, `SKILL_INVALID_ROLE`                                                                                                                                                                                                       | `ast-interpret-skill-quality`                                             |

### The `astConfig` file

`scripts/AST/ast-config.ts` is the single source of truth for all repo-specific conventions. It replaces hardcoded name lists scattered across tool files. Sections include:

- `hooks`: ambient leaf hooks, known context hooks, path patterns for classification
- `effects`: effect hook names, fetch/timer/storage function names
- `testing`: boundary packages, fixture patterns, provider signals
- `jsx`: transform methods, thresholds for violation detection
- `ownership`: layout exceptions, container markers, router hooks
- `intentMatcher`: signal weights, fail/warn thresholds, ignored observation kinds
  (calibration-managed by `/calibrate-ast-interpreter --tool intent`;
  current accuracy: 100% on 55 classifications across 9 fixtures)
- `testParity`: file mapping, helper dirs, auth methods, mock handler
  baseline marker
  (calibration-managed by `/calibrate-ast-interpreter --tool parity`;
  current accuracy: 100% on 26 classifications across 9 fixtures)

Interpreters read from `astConfig` to make classifications. When repo conventions change, update `astConfig` once -- all tools and interpreters pick up the change.

### Running AST tools

```bash
# Observation output (JSON by default)
npx tsx scripts/AST/ast-query.ts hooks src/ui/page_blocks/dashboard/team/

# Pretty-printed
npx tsx scripts/AST/ast-query.ts jsx src/ui/components/8flow/Table/ --pretty

# Filter by observation kind
npx tsx scripts/AST/ast-query.ts test-quality src/ui/page_blocks/dashboard/ --kind MOCK_DECLARATION

# Count mode for verification queries
npx tsx scripts/AST/ast-query.ts test-quality src/ui/page_blocks/dashboard/ --kind TIMER_NEGATIVE_ASSERTION --count

# Scan test files with any tool
npx tsx scripts/AST/ast-query.ts type-safety src/ui/page_blocks/dashboard/ --test-files --kind AS_UNKNOWN_AS_CAST

# Glob patterns
npx tsx scripts/AST/ast-query.ts type-safety "src/ui/page_blocks/dashboard/systems/**/*.tsx" --pretty

# Multi-file
npx tsx scripts/AST/ast-query.ts type-safety src/shared/utils/date/*.ts src/shared/utils/string/*.ts

# Run an interpreter
npx tsx scripts/AST/ast-query.ts interpret-effects src/ui/page_blocks/dashboard/team/
npx tsx scripts/AST/ast-query.ts interpret-ownership src/ui/page_blocks/dashboard/team/
```

All observation tools accept these flags:

- `--pretty` -- human-readable JSON output
- `--kind <KIND>` -- filter observations to a single kind
- `--count` -- output observation kind counts (e.g., `{"MOCK_DECLARATION": 5}`)
- `--test-files` -- scan test/spec files instead of production files
- `--no-cache` -- bypass the file-content cache

### Using observations vs assessments in skills

**Use observations when:**

- Building an inventory (hook call sites, import edges, effect locations)
- Counting structural features (line counts, method chains, dep array size)
- Checking for presence/absence of a pattern (does this file import X?)

**Use assessments when:**

- Making pass/fail decisions (is this hook call a violation?)
- Classifying code (is this component a container or a leaf?)
- Determining migration priority (which effects need refactoring first?)

Audit skills typically consume both: observations for the inventory tables, assessments for the violation reports. Refactor skills consume assessments to decide what to change. Build skills consume observations to understand the existing structure they need to fit into.

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

## Customization

These skills encode conventions specific to a particular codebase (directory structure, hook naming, context patterns). To adapt them:

- **MAY-remain hooks list.** Each skill has an allowlist of hooks that leaf components may keep (useBreakpoints, useWindowSize, etc.). Edit this list to match your codebase's DOM/browser utility hooks.
- **Directory conventions.** The skills expect `services/hooks/queries/`, `services/hooks/mutations/`, `shared/hooks/`, and `containers/`. Update these paths if your project uses different conventions.
- **Context hook names.** The audit and route skills reference specific context hooks (useInsightsContext, useTeams, etc.) as examples. These are illustrative -- the skills detect any `useContext` or context consumer hook pattern.

## License

MIT
