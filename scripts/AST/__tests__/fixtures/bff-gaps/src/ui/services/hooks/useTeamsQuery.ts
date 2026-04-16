import { useQuery } from '@tanstack/react-query';

export function useTeamsQuery(teamId: string) {
  return useQuery({
    queryKey: ['teams', teamId],
    queryFn: () => fetchApi(`/api/users/data-api/teams`, { schema: TeamsSchema }),
  });
}
