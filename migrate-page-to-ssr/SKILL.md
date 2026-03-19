---
name: migrate-page-to-ssr
description: Migrate a Next.js page from client-side-only data fetching to server-side rendering via getServerSideProps. Extracts server fetchers, seeds TanStack Query cache, preserves DDAU and fixture system.
context: fork
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
argument-hint: <path/to/pages/somePage.tsx>
---

Migrate the Next.js page at `$ARGUMENTS` from client-side-only data fetching to
server-side rendering via `getServerSideProps`.

## Prerequisites

This skill assumes all client-side fetching goes through `fetchApi` (via service
hooks in `src/ui/services/hooks/`). If any hook fetches data through another
path, migrate it to `fetchApi` first.

The BFF infrastructure is already in place:

- Firebase Admin: `src/server/db/firebase-admin.ts`
- Auth middleware: `src/server/middleware/withAuth.ts` (API routes)
- Postgres: `src/server/db/postgres.ts` (Drizzle ORM)
- ClickHouse: `src/server/db/clickhouse.ts`

For `getServerSideProps`, auth token delivery requires a cookie-based mechanism
(the existing `withAuth` middleware reads the `id_token` header, which is not
available in SSR). See the [Server Auth Bootstrap](#server-auth-bootstrap)
section at the end of this file for the cookie setup.

## Step 0: Run AST analysis on the container

After identifying the container file (follow imports from the page file
into `src/ui/page_blocks/`), run:

```bash
npx tsx scripts/AST/ast-data-layer.ts <container-path> --pretty
```

The tool emits data layer observations with structured evidence:

- `QUERY_HOOK_DEFINITION` observations with `name` and `queryKey` evidence
- `MUTATION_HOOK_DEFINITION` observations with `name` evidence
- `FETCH_API_CALL` observations with `url` and `schema` evidence
- `QUERY_KEY_FACTORY` observations with `keys` evidence
- `API_ENDPOINT` observations with `url` evidence

Use these observations to build the data dependency table in Step 1.
The `queryKey`, `url`, and `schema` evidence fields map directly to
the table columns.

## Step 1: Map the page's data dependencies

Read the target page file. Then read:

1. The container component it renders (follow imports into `src/ui/page_blocks/`)
2. Every service hook the container calls (imports from `src/ui/services/hooks/`)
3. For each service hook, identify:
   - The `fetchApi` endpoint (the URL string)
   - The Zod schema used for validation
   - The query key
   - Any query options (`enabled`, `staleTime`, `refetchOnWindowFocus`, etc.)
   - Any `select` transform applied to the response
   - Any parameters the hook receives (company, team IDs, date range, etc.)

Produce a table:

```
| Hook                     | Endpoint                              | Schema           | Params              | Enabled condition        |
|--------------------------|---------------------------------------|------------------|----------------------|--------------------------|
| useUsersQuery            | /users/data-api/users                 | UsersSchema      | none                 | always                   |
| useTeamsQuery            | /users/data-api/teams                 | TeamsSchema      | none                 | always                   |
| useCompanySpansQuery     | /api/company-data/spans               | SpansSchema      | company, dateRange   | !!company && !!dateRange |
```

Classify each hook into one of:

- **SSR candidate**: Always enabled on page load, no dependency on client-side
  interaction state (e.g., selected row, opened modal). These move to
  `getServerSideProps`.
- **Client-only**: Depends on user interaction state that does not exist at page
  load time (drill-down selections, search queries, pagination offsets driven by
  clicks). These stay as client-side hooks.

Only SSR candidates get server-side fetchers. Client-only hooks are untouched.

## Step 2: Create or extend the server fetcher module

For each SSR-candidate hook, create a server-side fetcher function. These live
in `src/server/fetchers/`.

### File placement

Group fetchers by domain. If the hooks come from
`src/ui/services/hooks/queries/users/`, the fetcher goes in
`src/server/fetchers/users.ts`. If the page needs fetchers from multiple
domains, create one file per domain.

### Fetcher pattern

Each fetcher is a plain async function (not a hook). It takes explicit
parameters and returns typed data.

```typescript
// src/server/fetchers/users.ts
import { db } from '@/server/db/postgres';
import { customerUser } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { UsersResponseSchema } from '@/shared/types/users';

export async function fetchUsersServer(organizationId: number) {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT === 'mocked') {
    const { usersFixtures, createPool } = await import('@/fixtures');
    const pool = createPool({ seed: 42 });
    return usersFixtures.buildMany(15, undefined, pool);
  }

  const rows = await db.select().from(customerUser).where(eq(customerUser.organizationId, organizationId));
  return UsersResponseSchema.parse(rows);
}
```

### Fetcher rules

1. **Reuse the same Zod schema** the client hook uses. Import from
   `@/shared/types/`. If the schema is only defined inline in the hook, extract
   it to the shared types module first.

2. **Fixture path for mocked mode.** When `NEXT_PUBLIC_ENVIRONMENT` is `'mocked'`,
   return fixture data directly. `local` mode uses real database queries via the BFF.
   Use dynamic `import('@/fixtures')` to keep fixtures out of the production bundle.
   Use a deterministic seed.

3. **Production path queries the database directly.** Do NOT call the app's own
   API routes from `getServerSideProps` (that would be an HTTP round-trip to
   self). For Postgres queries, import the Drizzle `db` client from
   `src/server/db/postgres.ts`. For ClickHouse queries, use the centralized
   query registry: import `CH_QUERIES` from `@/server/db/queries` and the
   generated row types from `@/server/db/queries.generated`. Do not write
   inline SQL or hand-written row interfaces. Read the corresponding API route
   handler in `src/pages/api/` to see which query it uses.

4. **No React hooks.** Server fetchers are plain functions. No `useFetchApi`,
   no `useAuthState`, no `useCompanyScope`.

5. **Auth token as parameter.** The caller (`getServerSideProps`) passes the
   token. The fetcher never reads cookies or request headers directly.

6. **Return the same shape the hook's `select` would produce.** If the client
   hook has a `select` that transforms the API response (unwrapping, mapping to
   branded types), apply the same transform in the fetcher. The page receives
   ready-to-render data.

### Database clients

The database clients already exist. Do not create new ones:

- **Postgres**: `import { db } from '@/server/db/postgres'` -- Drizzle ORM client.
  Schema tables are in `@/server/db/schema`, relations in `@/server/db/relations`.
- **ClickHouse**: `import { CH_QUERIES } from '@/server/db/queries'` -- centralized
  query registry with generated row types from `@/server/db/queries.generated`.
  Do not import the raw `clickhouse` client directly for queries that are already
  registered. See `AGENTS.md` "ClickHouse Type Codegen" section.
- **Firebase Admin**: `import { ... } from '@/server/db/firebase-admin'` -- for
  token verification and RTDB access.

Read the corresponding API route handler in `src/pages/api/` to see which
registered query it uses, and call the same query in the server fetcher.

## Step 3: Add `getServerSideProps` to the page

### 3a. Import dependencies

```typescript
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { getServerSession } from '@/server/middleware/withAuth';
```

### 3b. Write `getServerSideProps`

```typescript
export const getServerSideProps: GetServerSideProps = async ctx => {
  const session = await getServerSession(ctx.req);

  if (!session) {
    return {
      redirect: { destination: '/signin', permanent: false },
    };
  }

  const queryClient = new QueryClient();

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: usersQueryKeys.list(),
      queryFn: () => fetchUsersServer(session.token),
    }),
    queryClient.prefetchQuery({
      queryKey: teamsQueryKeys.list(),
      queryFn: () => fetchTeamsServer(session.token),
    }),
    // ... one prefetchQuery per SSR-candidate hook
  ]);

  return {
    props: {
      dehydratedState: dehydrate(queryClient),
    },
  };
};
```

### 3c. Critical details

- **Use the exact same query keys** the client hooks use. Import the query key
  factories from the same module the hooks import from. If the keys don't match,
  TanStack Query treats them as different queries and the client refetches on
  mount, defeating the purpose.

- **`prefetchQuery` not `fetchQuery`.** `prefetchQuery` does not throw on
  error — it stores the error in the cache and the client hook handles it. This
  prevents a server-side error from blocking the entire page render.

- **`Promise.all` for parallel fetching.** Independent queries should fire
  concurrently. Only use sequential `await` when one query's params depend on
  another's result.

- **Parametric queries.** If a hook needs `company` or `teamId` from the URL
  or from session data, extract it from `ctx.query` or `session`:

  ```typescript
  const company = session.company ?? 'acme';
  const teamId = ctx.query.id as string;
  ```

- **Conditional queries.** If a hook has an `enabled` condition that depends on
  URL params, check the condition before prefetching. If the condition is false,
  skip the prefetch — the client hook will also skip it.

## Step 4: Wire dehydrated state into the page component

### 4a. Update `_app.tsx` (one-time, first migration only)

If `_app.tsx` does not already support `dehydratedState`, wrap the
`QueryClientProvider` with `HydrationBoundary`:

```typescript
import { HydrationBoundary } from '@tanstack/react-query';

function MainApp({ Component, pageProps }: AppPropsWithLayout) {
  // ...
  return (
    <Providers>
      <NuqsAdapter>
        <HydrationBoundary state={pageProps.dehydratedState}>
          {getLayout(<Component {...pageProps} />)}
        </HydrationBoundary>
      </NuqsAdapter>
    </Providers>
  );
}
```

Check where `QueryClientProvider` lives (it may be inside `<Providers>`). The
`HydrationBoundary` must be a child of `QueryClientProvider`. If
`QueryClientProvider` is inside `Providers`, place `HydrationBoundary` in
`_app.tsx` after `Providers` renders, wrapping the page component.

**Do this only once.** After the first page migration, `_app.tsx` is set up for
all subsequent pages. Verify by checking if `HydrationBoundary` already exists.

### 4b. Update the page component signature

The page component receives `dehydratedState` via `pageProps` but does not need
to reference it directly — `HydrationBoundary` in `_app.tsx` handles it. The
page component's signature does not change. TanStack Query hooks in the
container will find their data already in the cache and skip the loading state
on first render.

### 4c. Verify the hooks still work

The existing service hooks (`useUsersQuery`, etc.) are unchanged. They keep
their `queryKey`, `queryFn`, `staleTime`, etc. On the client:

1. `HydrationBoundary` seeds the query cache with server-fetched data.
2. The hook mounts, finds data in the cache, returns it immediately (no loading
   state).
3. Background refetch may fire based on `staleTime` settings.

**Do not add `initialData` to the hooks.** The dehydrate/hydrate pattern
handles this automatically. `initialData` and dehydration serve different
purposes — mixing them causes subtle bugs.

## Step 5: Handle auth guard interaction

Many pages wrap content in `RequireLoginMaybe` or similar auth guards. With
`getServerSideProps` handling auth, there are two options:

**Option A (recommended): Server-side redirect.** The `getServerSideProps`
already checks `session` and redirects to `/signin` if null. The auth guard
in the component tree becomes redundant for the auth check but may still
enforce role-based access. Keep the guard if it checks roles; remove it if it
only checks "is logged in."

**Option B: Keep both.** The server redirect handles the fast path (no
session = instant redirect, no page render). The client guard handles edge
cases (session expires mid-session). This is defensive but acceptable.

Choose Option A unless the page has role-based guards. Document your choice in
the commit message.

## Step 6: Verify

### 6a. Type check

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```

Zero errors in changed files. The new server fetcher functions must have fully
typed parameters and return types.

### 6b. Build

```bash
pnpm build
```

Must pass. `getServerSideProps` pages are marked with `ƒ` (dynamic) in the
build output — verify your page appears there, not with `○` (static).

### 6c. Tests

Run existing tests for the page and its container:

```bash
pnpm vitest run <path-to-spec-files>
```

Existing tests should pass unchanged — the hooks are unchanged, the container
is unchanged, the components are unchanged. The only change is that data
arrives in the cache before mount instead of after.

If tests mock the service hooks, they will still work because the hooks have
the same interface. If tests render the full page, they may need the
`HydrationBoundary` wrapper — add it to the test's render wrapper if needed.

### 6d. Manual verification (if dev server available)

Start the dev server:

```bash
pnpm dev
```

1. Navigate to the page. It should render with data immediately (no loading
   spinner flash).
2. Check the Network tab: the page HTML response should contain the rendered
   data (view source, search for a known data value).
3. Client-side navigation to the page should still work (TanStack Query
   refetches in the background if stale).

## Step 7: Report

Output a summary:

```
## SSR Migration: <PageName>

### Server fetchers created
- src/server/fetchers/<domain>.ts: <function names>

### Queries moved to SSR
| Query key           | Fetcher function      | Fixture source (mocked mode)   |
|--------------------|-----------------------|--------------------------------|
| users.list()       | fetchUsersServer      | usersFixtures.buildMany(15)    |
| teams.list()       | fetchTeamsServer      | teamsFixtures.buildAll()       |

### Queries kept client-only
| Hook                        | Reason                              |
|-----------------------------|-------------------------------------|
| useUserDrilldownQuery       | Depends on selected row (user click)|

### Files changed
- src/pages/<page>.tsx — added getServerSideProps
- src/server/fetchers/<domain>.ts — new file
- src/pages/_app.tsx — added HydrationBoundary (first migration only)

### Verification
- tsc: <pass/fail>
- build: <pass/fail> (page shows ƒ dynamic)
- tests: <pass/fail/none>
```

---

## Server Auth Bootstrap

Firebase Admin and auth verification already exist in the codebase:

- `src/server/db/firebase-admin.ts` -- Firebase Admin lazy singleton
- `src/server/middleware/withAuth.ts` -- verifies `id_token` header, resolves
  `organizationId` from Postgres

The `withAuth` middleware reads the `id_token` request header (set by
`useFetchApi` on client-side fetch calls). This works for API routes but NOT
for `getServerSideProps`, which receives the raw browser request (no custom
headers).

### Cookie-based token delivery for SSR

To make the ID token available in `getServerSideProps`, you need a cookie-based
delivery mechanism. This is a one-time setup:

### Step A: Create `src/server/middleware/withAuth.ts` (or extend the existing module)

```typescript
import type { IncomingMessage } from 'http';
import { getAuth } from '@/server/db/firebase-admin';
import { resolveOrganization } from '@/server/middleware/withAuth';

interface ServerSession {
  uid: string;
  organizationId: number;
  token: string;
  email: string | undefined;
}

export async function getServerSession(
  req: IncomingMessage & { cookies: Partial<Record<string, string>> },
): Promise<ServerSession | null> {
  if (process.env.NEXT_PUBLIC_ENVIRONMENT === 'mocked') {
    return {
      uid: 'local-dev-user',
      organizationId: 0,
      token: 'mock-token',
      email: 'dev@local.test',
    };
  }

  const idToken = req.cookies['__session'] ?? (req.headers['id_token'] as string | undefined);
  if (!idToken) return null;

  try {
    const decoded = await getAuth().verifyIdToken(idToken);
    const organizationId = await resolveOrganization(decoded.uid);
    return {
      uid: decoded.uid,
      organizationId,
      token: idToken,
      email: decoded.email,
    };
  } catch {
    return null;
  }
}
```

### Step B: Set the session cookie on client-side sign-in

In the auth state observer, set the ID token as a cookie so
`getServerSideProps` can read it:

```typescript
onAuthStateChanged(auth, async user => {
  if (user) {
    const token = await user.getIdToken();
    document.cookie = `__session=${token}; path=/; max-age=3600; SameSite=Lax`;
  } else {
    document.cookie = '__session=; path=/; max-age=0';
  }
});
```

Firebase tokens expire after 1 hour, so the cookie must be refreshed on
token refresh as well.

### Step C: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```

Test by adding a temporary `getServerSideProps` to any page that logs
the session. Check the terminal (not browser console) for the output.
Remove the temporary code after confirming.

---

## Checklist (copy into PR description)

- [ ] Server fetchers created in `src/server/fetchers/`
- [ ] Fetchers return fixture data when `NEXT_PUBLIC_ENVIRONMENT` is `mocked`
- [ ] Fetchers query the database directly in production (no self HTTP call)
- [ ] Fetchers reuse existing Zod schemas from `@/shared/types/`
- [ ] `getServerSideProps` uses exact same query keys as client hooks
- [ ] `prefetchQuery` (not `fetchQuery`) for error resilience
- [ ] Independent queries run in `Promise.all`
- [ ] `HydrationBoundary` added to `_app.tsx` (first migration only)
- [ ] No `initialData` added to client hooks (dehydrate handles it)
- [ ] Page shows `ƒ` (dynamic) in build output
- [ ] `pnpm tsc --noEmit -p tsconfig.check.json` passes
- [ ] `pnpm build` passes
- [ ] Existing tests pass unchanged
- [ ] Client hooks unchanged (same queryKey, queryFn, options)
- [ ] DDAU preserved (containers still own all orchestration)
- [ ] Documentation audit: grep `docs/` and `CLAUDE.md` for references to the migrated page's old data-fetching pattern and update any that are now stale
