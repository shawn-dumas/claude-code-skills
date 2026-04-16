/** Extracted from src/server/handlers/users/teams/create.logic.ts -- simplified for fixture */

interface TeamRow {
  id: number;
  name: string;
  active: boolean;
  organizationId: number;
  createdAt: string;
  lastUpdated: string;
  countUsers: number;
}

export function toTeamResponse(row: TeamRow): { id: number; name: string; memberCount: number } {
  return { id: row.id, name: row.name, memberCount: row.countUsers };
}
