/* eslint-disable */
// Fixture: invalidateQueries call patterns that exercise lines 366-368
// in extractInvalidationKeyText (ast-data-layer.ts).

import { useMutation, useQueryClient } from '@tanstack/react-query';

// MUTATION_HOOK_DEF that calls invalidateQueries with an object that has NO queryKey prop
// -> exercises line 366: object literal but no queryKey -> returns ''
export function useInvalidateNoKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => ({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ exact: true });
    },
  });
}

// MUTATION_HOOK_DEF that calls invalidateQueries with a plain array (non-object first arg)
// -> exercises line 368: non-object arg -> returns truncateText(firstArg.getText())
export function useInvalidateArrayKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => ({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries(['items', 'list']);
    },
  });
}
