# Synthetic Skill: Convention Drift (Missing Current)

Migrate a page to server-side rendering with ClickHouse data.

## Step 1: Create the server fetcher

Import the database client for `src/server/db/clickhouse.ts` and
query the ClickHouse data directly in `getServerSideProps`:

```typescript
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async context => {
  const data = await fetchDashboardData(context.params?.id as string);
  return { props: { data } };
};
```

The ClickHouse client handles connection pooling automatically.

## Step 2: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
