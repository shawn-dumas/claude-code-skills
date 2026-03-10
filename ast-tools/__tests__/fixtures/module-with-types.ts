// Module with various type-safety patterns for ast-type-safety to detect

interface User {
  id: string;
  name: string;
  email: string | null;
}

// AS_ANY: casting to any
export function unsafeParse(data: unknown): User {
  return data as any;
}

// AS_UNKNOWN_AS: double cast
export function doubleCast(data: string): number {
  return data as unknown as number;
}

// NON_NULL_ASSERTION: using !
export function assertDefined(users: User[]): string {
  return users.find(u => u.name === 'admin')!.email!;
}

// EXPLICIT_ANY_ANNOTATION: any in type position
export function acceptsAnything(value: any): void {
  console.log(value);
}

// CATCH_ERROR_ANY
export function tryCatchAny(): void {
  try {
    JSON.parse('invalid');
  } catch (e: any) {
    console.error(e.message);
  }
}

// Branded type usage (legitimate -- should NOT be flagged)
type UserId = string & { __brand: 'UserId' };
export function createUserId(raw: string): UserId {
  return raw as UserId;
}
