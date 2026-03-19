# Synthetic Skill: Convention Aligned

Build a BFF API handler for the given endpoint.

## Step 1: Create the handler

The handler validates request input using `parseInput` and queries the database:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/server/db/postgres';
import { parseInput } from '@/server/errors/ApiErrorResponse';
import { BodySchema, ParamSchema } from './handler.schema';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = parseInput(ParamSchema, req.query);
  const body = parseInput(BodySchema, req.body);

  const rows = await db.select().from(users).where(eq(users.id, id));
  return res.status(200).json(rows[0]);
}
```

## Step 2: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
