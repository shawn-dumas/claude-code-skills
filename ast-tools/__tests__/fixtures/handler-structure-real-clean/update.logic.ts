/** Extracted from src/server/handlers/users/update.logic.ts -- simplified for fixture */

export async function updateDisplayName(uid: string, name: string, orgId: number, now: string): Promise<void> {
  void uid;
  void name;
  void orgId;
  void now;
}

export async function updateRole(uid: string, role: string, orgId: number, now: string): Promise<void> {
  void uid;
  void role;
  void orgId;
  void now;
}

export async function replaceTeamMemberships(
  uid: string,
  teamIds: number[],
  ownedTeamIds: number[],
  orgId: number,
  now: string,
): Promise<void> {
  void uid;
  void teamIds;
  void ownedTeamIds;
  void orgId;
  void now;
}

export async function updateOwnedTeamMemberships(
  uid: string,
  ownedTeamIds: number[],
  orgId: number,
  now: string,
): Promise<void> {
  void uid;
  void ownedTeamIds;
  void orgId;
  void now;
}

export function buildActivityDetails(params: {
  role?: string;
  name?: string;
  team_ids?: number[];
  organizationId: number;
}): string {
  return JSON.stringify(params);
}

export async function logUpdateActivity(actorUid: string, targetUid: string, details: string): Promise<void> {
  void actorUid;
  void targetUid;
  void details;
}
