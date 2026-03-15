import { useQuery } from '@tanstack/react-query';
import { useFetchApi } from '@/shared/lib/fetchApi';
import toast from 'react-hot-toast';
import { sendPosthogEvent } from '@/shared/lib/posthog';
import { z } from 'zod';

const schema = z.array(z.object({ id: z.string(), name: z.string() }));

export function useTeamsQuery() {
  const fetchApi = useFetchApi();

  return useQuery({
    queryKey: ['teams'],
    queryFn: () => fetchApi({ url: '/api/teams', schema }),
    onSuccess: data => {
      toast.success(`Loaded ${data.length} teams`);
      sendPosthogEvent('teams_loaded', { count: data.length });
    },
  });
}
