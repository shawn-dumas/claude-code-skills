/**
 * Simplified version of src/shared/utils/user/mapUserRoleName.ts.
 * Real file imports from constants and types. This fixture is self-contained.
 */

const USER_ROLES_MAP: Record<string, string> = {
  admin: 'Admin',
  member: 'Member',
  teamowner: 'Team Owner',
  superadmin: 'Super Admin',
};

export function mapUserRoleName(role: string): string {
  return USER_ROLES_MAP[role] ?? role;
}
