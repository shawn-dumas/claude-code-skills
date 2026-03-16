/**
 * Stripped from src/server/middleware/withRole.ts
 * Imports AuthedContext from withAuth.ts, creating a circular dependency.
 * Also exports ASSIGN_ROLES which is dead (no consumers).
 */
import type { AuthedContext } from './withAuth';
import { ForbiddenError } from './errors';

export const Role = {
  Member: 'member',
  TeamOwner: 'teamowner',
  Admin: 'admin',
  InternalAdmin: 'internal:admin',
} as const;

export type RoleValue = (typeof Role)[keyof typeof Role];

export const DEFAULT_ROLE: RoleValue = Role.Member;

type AuthedHandler = (
  ctx: AuthedContext,
  req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) => Promise<void> | void;

export function withRole(allowedRoles: RoleValue[], handler: AuthedHandler): AuthedHandler {
  return async (ctx, req, res) => {
    const hasRole = ctx.roles.some(r => allowedRoles.includes(r as RoleValue));
    if (!hasRole) {
      throw new ForbiddenError('Insufficient role');
    }
    await handler(ctx, req, res);
  };
}

/** Dead export -- no consumers in the fixture graph */
export const ASSIGN_ROLES: RoleValue[] = [Role.TeamOwner, Role.Admin, Role.InternalAdmin];
