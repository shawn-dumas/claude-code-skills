/**
 * Stripped from src/server/middleware/withAuth.ts
 * Introduces a circular dependency by importing DEFAULT_ROLE from withRole.ts.
 * In reality this import does not exist -- it is added to model a circular dep.
 */
import { unauthorized, forbidden } from './errors';
import { DEFAULT_ROLE } from './withRole';

export interface AuthedContext {
  userId: string;
  organizationId: number;
  company: string;
  requestId: string;
  roles: string[];
}

type AuthedHandler = (
  ctx: AuthedContext,
  req: unknown,
  res: { status: (code: number) => { json: (body: unknown) => void } },
) => Promise<void> | void;

export function withAuth(handler: AuthedHandler) {
  return async (req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
    const requestId = 'test-request';
    const token = 'test-token';

    if (!token) {
      res.status(401).json(unauthorized(requestId));
      return;
    }

    await handler(
      {
        userId: 'user-1',
        organizationId: 1,
        company: 'test',
        requestId,
        roles: [DEFAULT_ROLE],
      },
      req,
      res,
    );
  };
}
