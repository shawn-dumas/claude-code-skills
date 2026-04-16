import { useQuery } from '@tanstack/react-query';
import { useFetchApi } from '@/shared/lib/fetchApi';
import { z } from 'zod';

const schema = z.array(z.object({ id: z.string() }));

export function useTeamData() {
  const fetchApi = useFetchApi();

  return useQuery({
    queryKey: ['teams'],
    queryFn: () => fetchApi({ url: '/api/teams', schema }),
  });
}
