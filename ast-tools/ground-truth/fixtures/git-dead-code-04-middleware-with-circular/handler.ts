/**
 * Stripped from src/pages/api/users/update.ts
 * Consumes withAuth, withRole, and Role from middleware.
 */
import { withAuth } from './withAuth';
import { withRole, Role } from './withRole';

function handleUpdate(
  ctx: { userId: string; requestId: string },
  _req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) {
  res.status(200).json({ ok: true, updatedBy: ctx.userId });
}

export const updateHandler = withAuth(withRole([Role.Admin, Role.InternalAdmin], handleUpdate));
