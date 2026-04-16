/**
 * Another untested file with high cyclomatic complexity.
 * No dedicated spec, not imported by any spec.
 */
export function routeRequest(
  method: string,
  path: string,
  headers: Record<string, string>,
  body: unknown,
): { status: number; response: unknown } {
  if (method === 'GET') {
    if (path.startsWith('/api/users')) {
      if (headers['authorization']) {
        return { status: 200, response: { users: [] } };
      } else {
        return { status: 401, response: { error: 'unauthorized' } };
      }
    } else if (path.startsWith('/api/teams')) {
      if (headers['x-team-id']) {
        return { status: 200, response: { teams: [] } };
      } else {
        return { status: 400, response: { error: 'missing team id' } };
      }
    } else if (path === '/api/health') {
      return { status: 200, response: { ok: true } };
    } else {
      return { status: 404, response: { error: 'not found' } };
    }
  } else if (method === 'POST') {
    if (!body) {
      return { status: 400, response: { error: 'missing body' } };
    }
    if (path.startsWith('/api/users')) {
      if (headers['content-type'] === 'application/json') {
        return { status: 201, response: { created: true } };
      } else {
        return { status: 415, response: { error: 'unsupported media type' } };
      }
    } else if (path.startsWith('/api/teams')) {
      return { status: 201, response: { created: true } };
    } else {
      return { status: 404, response: { error: 'not found' } };
    }
  } else if (method === 'DELETE') {
    if (!headers['authorization']) {
      return { status: 401, response: { error: 'unauthorized' } };
    }
    if (path.startsWith('/api/users/')) {
      return { status: 204, response: null };
    } else {
      return { status: 404, response: { error: 'not found' } };
    }
  } else {
    return { status: 405, response: { error: 'method not allowed' } };
  }
}
