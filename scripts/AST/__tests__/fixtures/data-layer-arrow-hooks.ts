/* eslint-disable */
// Fixture: hook definitions using const arrow function syntax (not function declarations).
// Tests lines 191-196 in ast-data-layer.ts (variable declaration path).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

const ArrowSchema = {};

// QUERY_HOOK_DEF via arrow function variable declaration
export const useArrowQuery = (id: string) =>
  useQuery({
    queryKey: ['arrow', id],
    queryFn: async () => ({ id }),
  });

// MUTATION_HOOK_DEF via arrow function variable declaration
export const useArrowMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { name: string }) => params,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['arrow'] });
    },
  });
};
