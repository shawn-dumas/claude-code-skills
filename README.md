# Claude Code Skills for React Architecture

A set of [Claude Code skills](https://docs.anthropic.com/en/docs/claude-code/skills) that enforce a consistent React architecture during refactoring. They audit code against a shared set of principles and then rewrite it to comply, verifying with TypeScript and tests before finishing.

These skills are opinionated. They encode a specific architectural model that prioritizes explicit data flow, clear ownership boundaries, and minimal coupling. If your codebase follows different conventions, you will want to fork and adapt them.

## Principles

Every skill in this repo enforces the same core rules. Understanding them is more important than memorizing the individual skills.

### Data Down, Actions Up (DDAU)

A component's Props interface is its complete dependency list. Data arrives via props. Actions fire via callback props. The component never reaches into global state, context, or the router on its own. After refactoring, you should be able to render the component with nothing but props -- no provider tree required.

### Container boundaries

Each route has exactly one container component that sits between the outside world (hooks, context, routing, storage, toasts) and the inside world (props-only components). The container calls all service hooks, context hooks, and router hooks. It passes data down and wires callbacks up. Children never call these hooks directly.

### Separation of concerns

Each layer has a single job:

| Layer | Responsibility | Must NOT |
|-------|---------------|----------|
| **Service hooks** | Fetch and mutate data via useQuery/useMutation | Fire toasts, navigate, write to storage, import cross-domain query keys |
| **Containers** | Wire hooks to components, handle events, manage user feedback | Render complex UI (that belongs in children) |
| **Components** | Render from props | Call service hooks, context hooks, useRouter, or access browser storage |
| **Providers** | Hold shared UI state only | Fetch data, own query logic, watch auth state |

### Least power

Give each piece of code the minimum capability it needs:

- If a value is computable from props or state, compute it inline or with useMemo. Do not store it in separate state.
- If a component only reads a value, do not pass it the setter.
- If a hook returns 15 fields and every consumer uses 3, narrow the return type.
- If a context has 20 fields and consumers typically use 2-3, split it.

### useEffect discipline

Most useEffects are wrong. Each one gets classified:

| Classification | Correct action |
|---------------|---------------|
| Derived state (useEffect + setState where the value is computable) | Replace with useMemo or inline |
| Prop sync (mirrors a prop into local state) | Controlled component or useMemo |
| Event handler in disguise (reacts to state set by a user action) | Move logic to the event handler |
| Mapper side effect (setState inside TanStack Query `select`) | Read from `.data` directly |
| External system subscription (WebSocket, ResizeObserver) | Keep |
| Unmount cleanup | Keep |

### Single-domain ownership

A service hook imports only its own domain's query keys. Cross-domain cache invalidation happens in the container's mutation `onSuccess` callback, not inside the hook. This prevents circular imports and makes invalidation visible at the orchestration layer.

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

## Skills

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

The ordering is not arbitrary -- it mirrors the dependency graph. You cannot convert components to DDAU until containers exist to absorb their hook calls. Containers cannot be clean until service hooks are standalone and side-effect-free. Service hooks cannot be standalone until factory indirection is eliminated. Each phase unblocks the next.

The audit skill produces a migration checklist in exactly this order, and each checklist item maps to a specific skill invocation. The output of step 1 is the script for steps 2-5.

1. **Audit first.** Run `audit-react-feature` on the feature directory. Read the report. Understand the dependency graph before changing anything.

2. **Service hooks.** Use `refactor-react-service-hook` to clean up data-fetching hooks. Strip side effects, remove factory indirection, enforce single-domain keys. This is the foundation -- containers need clean hooks to wire.

3. **Providers.** Use `refactor-react-provider` to strip data-fetching from providers, split broad contexts, and set up cleanup registration. After this step, providers hold only shared UI state.

4. **Routes/containers.** Use `refactor-react-route` to establish or complete the container boundary for each route. The container absorbs all hook calls, storage, toasts, and cross-domain invalidation.

5. **Components.** Use `refactor-react-component` on remaining self-contained components to convert them to DDAU. At this point the container exists, so the component just needs its hooks removed and its Props interface defined.

Each refactor skill runs TypeScript type-checking and available tests after rewriting to verify nothing broke.

## Customization

These skills encode conventions specific to a particular codebase (directory structure, hook naming, context patterns). To adapt them:

- **MAY-remain hooks list.** Each skill has an allowlist of hooks that leaf components may keep (useBreakpoints, useWindowSize, etc.). Edit this list to match your codebase's DOM/browser utility hooks.
- **Directory conventions.** The skills expect `services/hooks/queries/`, `services/hooks/mutations/`, `shared/hooks/`, and `containers/`. Update these paths if your project uses different conventions.
- **Context hook names.** The audit and route skills reference specific context hooks (useInsightsContext, useTeams, etc.) as examples. These are illustrative -- the skills detect any `useContext` or context consumer hook pattern.

## License

MIT
