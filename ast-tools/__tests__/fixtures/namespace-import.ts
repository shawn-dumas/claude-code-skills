import * as Types from './module-with-types';

export function parseUser(data: unknown): string {
  const user = Types.unsafeParse(data);
  return user.toString();
}
