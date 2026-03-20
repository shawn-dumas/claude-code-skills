/**
 * Real-world fixture based on src/pages/api/users/teams/create.ts.
 * Imports toTeamResponse from .logic but has significant inline DB logic.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { toTeamResponse } from './create.logic';

interface AuthedContext {
  organizationId: number;
}

async function handler(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  const { name } = req.body;

  const now = new Date().toISOString();

  // Reject duplicate team names within the same organization
  const duplicate = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, ctx.organizationId), eq(team.name, name), eq(team.active, true)))
    .limit(1);

  if (duplicate.length > 0) {
    throw new Error(`Team name "${name}" already exists`);
  }

  const inserted = await db
    .insert(team)
    .values({
      name,
      organizationId: ctx.organizationId,
      active: true,
      createdAt: now,
      lastUpdated: now,
    })
    .returning();

  const newTeam = inserted[0];
  const countRows = await db
    .select({ count_users: count(userTeam.uid) })
    .from(userTeam)
    .where(
      and(
        eq(userTeam.teamId, newTeam.id),
        eq(userTeam.organizationId, newTeam.organizationId),
        eq(userTeam.active, true),
      ),
    );

  const validated = toTeamResponse({
    id: newTeam.id,
    name: newTeam.name,
    active: newTeam.active,
    organizationId: newTeam.organizationId,
    createdAt: newTeam.createdAt,
    lastUpdated: newTeam.lastUpdated,
    countUsers: countRows[0]?.count_users ?? 0,
  });

  res.status(200).json(validated);
}

// Stubs for fixture compilation
const db: any = {};
const team: any = {};
const userTeam: any = {};
const and: any = () => {};
const eq: any = () => {};
const count: any = () => {};

export default handler;
