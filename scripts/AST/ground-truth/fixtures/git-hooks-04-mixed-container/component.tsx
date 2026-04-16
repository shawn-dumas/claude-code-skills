/* eslint-disable */
// Extracted from: src/ui/page_blocks/dashboard/opportunities/OpportunityFilters/OpportunitiesFiltersContainer.tsx
import React, { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOpportunitiesUrlParams } from '../useOpportunitiesUrlParams';
import { useTeamsListQuery } from '@/services/hooks/queries/teams';
import { useAuthState } from '@/providers/context/auth';
import { usePosthogContext } from '@/providers/posthogProvider';
import { useDashboardFiltersState } from '@/providers/context/layout';

interface Props {
  variant?: 'opportunities' | 'systems';
}

export function OpportunitiesFiltersContainer({ variant = 'opportunities' }: Props) {
  const queryClient = useQueryClient();
  const { featureFlags } = usePosthogContext();
  const { roles } = useAuthState();
  const { setFiltersSubmitted } = useDashboardFiltersState();
  const [urlFilters, setUrlFilters] = useOpportunitiesUrlParams();
  const { data: teams } = useTeamsListQuery({});
  const teamsItems = useMemo(() => teams ?? [], [teams]);
  const handleSubmit = useCallback(() => setFiltersSubmitted(), [setFiltersSubmitted]);

  return <div>{JSON.stringify({ teamsItems, variant, featureFlags, roles })}</div>;
}
