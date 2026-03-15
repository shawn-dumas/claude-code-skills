import React, { createContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFetchApi } from '@/shared/lib/fetchApi';
import { z } from 'zod';

const schema = z.array(z.object({ id: z.string() }));
const TeamContext = createContext(null);

export function TeamProvider({ children }: { children: React.ReactNode }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const fetchApi = useFetchApi();

  const { data } = useQuery({
    queryKey: ['teams'],
    queryFn: () => fetchApi({ url: '/api/teams', schema }),
  });

  return <TeamContext.Provider value={{ data, selectedId, setSelectedId }}>{children}</TeamContext.Provider>;
}
