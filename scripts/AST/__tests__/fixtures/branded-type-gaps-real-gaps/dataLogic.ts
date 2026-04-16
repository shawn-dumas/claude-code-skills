/**
 * Real-world fixture (simplified): Functions using bare primitives where branded types exist.
 * Based on src/server/handlers/users/user-data.logic.ts
 *
 * Expected: UNBRANDED_PARAM for userId: string and organizationId: number.
 */

export async function fetchActorTeamIds(userId: string, organizationId: number): Promise<number[]> {
  // Simulates DB query
  void userId;
  void organizationId;
  return [1, 2, 3];
}

export async function fetchTeammateUids(teamIds: number[], organizationId: number): Promise<Set<string>> {
  // Simulates DB query
  void teamIds;
  void organizationId;
  return new Set(['uid1', 'uid2']);
}

export async function fetchActiveUsers(organizationId: number): Promise<string[]> {
  void organizationId;
  return ['user1', 'user2'];
}
