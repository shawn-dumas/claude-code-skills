/**
 * Real-world fixture based on src/pages/api/users/update.ts.
 * Delegates all business logic to update.logic.ts.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  updateDisplayName,
  updateRole,
  replaceTeamMemberships,
  updateOwnedTeamMemberships,
  logUpdateActivity,
  buildActivityDetails,
} from './update.logic';

interface AuthedContext {
  userId: string;
  organizationId: number;
}

async function handler(ctx: AuthedContext, req: NextApiRequest, res: NextApiResponse) {
  const { uid, role, team_ids, owned_team_ids, name } = req.body;
  const now = new Date().toISOString();

  if (name !== undefined) {
    await updateDisplayName(uid, name, ctx.organizationId, now);
  }

  if (role !== undefined) {
    await updateRole(uid, role, ctx.organizationId, now);
  }

  if (team_ids !== undefined) {
    await replaceTeamMemberships(uid, team_ids, owned_team_ids ?? [], ctx.organizationId, now);
  } else if (owned_team_ids !== undefined) {
    await updateOwnedTeamMemberships(uid, owned_team_ids, ctx.organizationId, now);
  }

  const details = buildActivityDetails({ role, name, team_ids, organizationId: ctx.organizationId });
  await logUpdateActivity(ctx.userId, uid, details);

  return res.status(200).json(true);
}

export default handler;
