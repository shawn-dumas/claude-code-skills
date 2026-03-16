/**
 * Stripped from src/server/errors/ApiErrorResponse.ts
 * Error factory functions and error classes consumed by middleware.
 * unprocessable is dead -- no consumers in the fixture graph.
 */
export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

export function unauthorized(requestId: string): ApiErrorResponse {
  return {
    error: { code: 'UNAUTHORIZED', message: 'Authentication required.', requestId },
  };
}

export function forbidden(requestId: string): ApiErrorResponse {
  return {
    error: { code: 'FORBIDDEN', message: 'Access denied.', requestId },
  };
}

/** Dead export -- no consumers in the fixture graph */
export function unprocessable(requestId: string): ApiErrorResponse {
  return {
    error: { code: 'UNPROCESSABLE', message: 'Request could not be processed.', requestId },
  };
}

export class ForbiddenError extends Error {
  constructor(message = 'Access denied') {
    super(message);
    this.name = 'ForbiddenError';
  }
}
