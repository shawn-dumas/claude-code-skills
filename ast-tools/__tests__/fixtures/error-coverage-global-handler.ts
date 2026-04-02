/* eslint-disable */
// Fixture: file-local global error handler via new MutationCache({ onError })
// Used to cover the fileHasGlobalHandler branch in analyzeErrorCoverage (line 397-412)

import { MutationCache } from '@tanstack/react-query';

export const mutationCache = new MutationCache({
  onError: (error: unknown) => {
    console.error('Global mutation error:', error);
  },
});
