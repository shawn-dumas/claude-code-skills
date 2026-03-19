# Synthetic Skill: Convention Drift (Superseded Pattern)

Build a BFF API handler for the given endpoint.

## Step 1: Create the handler

The handler validates request input and queries the database:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '@/server/db/postgres';
import { BodySchema, ParamSchema } from './handler.schema';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = ParamSchema.parse(req.query);
  const body = BodySchema.parse(req.body);

  const rows = await db.select().from(users).where(eq(users.id, id));
  return res.status(200).json(rows[0]);
}
```

## Step 2: Verify

```bash
pnpm tsc --noEmit -p tsconfig.check.json
```
