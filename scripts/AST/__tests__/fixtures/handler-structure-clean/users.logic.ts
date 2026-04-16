export function fetchUsers(): string[] {
  return ['alice', 'bob'];
}

export function formatUsers(users: string[]): { names: string[] } {
  return { names: users.map(u => u.toUpperCase()) };
}
