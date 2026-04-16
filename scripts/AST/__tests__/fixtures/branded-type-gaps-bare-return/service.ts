/**
 * Fixture: Function returning bare primitive where branded type is expected.
 * Expected: UNBRANDED_PARAM for return type.
 */

export function getUserId(): string {
  return 'firebase-uid-123';
}

export function getTeamId(): number {
  return 42;
}

// This should NOT be flagged -- the function name does not suggest a branded return
export function getUserName(): string {
  return 'John Doe';
}

// This should NOT be flagged -- already returns a more complex type
export function fetchUser(): { userId: string } {
  return { userId: 'abc' };
}
