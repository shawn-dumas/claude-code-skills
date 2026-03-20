/**
 * Fixture: Clean function using branded types correctly.
 * Expected: no UNBRANDED_PARAM observations.
 */

type UserId = string & { readonly __brand: 'UserId' };
type TeamId = number & { readonly __brand: 'TeamId' };

export function getUser(userId: UserId): { id: UserId; name: string } {
  return { id: userId, name: 'Test' };
}

export function getTeamMembers(teamId: TeamId, userId: UserId): string[] {
  return [String(teamId), String(userId)];
}

export const fetchUserData = (userId: UserId): Promise<unknown> => {
  return Promise.resolve({ uid: userId });
};

export class UserService {
  getProfile(userId: UserId): string {
    return String(userId);
  }
}
