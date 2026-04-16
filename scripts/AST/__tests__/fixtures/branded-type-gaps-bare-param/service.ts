/**
 * Fixture: Function with bare primitive where branded type is expected.
 * Expected: UNBRANDED_PARAM for userId: string.
 */

export function getUser(userId: string): unknown {
  return { uid: userId };
}

export function getTeamData(teamId: number): unknown {
  return { id: teamId };
}

export const fetchWorkstream = (workstreamId: string): Promise<unknown> => {
  return Promise.resolve({ id: workstreamId });
};

export class DataService {
  lookupUser(userId: string): unknown {
    return { uid: userId };
  }
}

// This should NOT be flagged because 'name' is in paramExcludeNames
export function findByName(name: string): unknown {
  return { name };
}

// This should NOT be flagged because 'description' is in paramExcludeNames
export function setDescription(description: string): void {
  void description;
}
