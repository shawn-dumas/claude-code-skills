/* eslint-disable */
// Extracted from: src/ui/page_blocks/dashboard/opportunities/MicroworkflowDetailsTable/MicroworkflowDetailsContainer.tsx
import { useMicroworkflowDetailsQuery } from '@/services/hooks/queries/insights';
import { getMicroworkflowsByUserQueryParams } from '@/shared/utils/insightsQueryParams';
import { useMemo } from 'react';
import { Loader } from '@/shared/ui';

interface Props {
  selectedUserEmail: string;
  isAnalyzerEnabled: boolean;
}

export function MicroworkflowDetailsContainer({ selectedUserEmail, isAnalyzerEnabled }: Props) {
  const queryParams = useMemo(() => getMicroworkflowsByUserQueryParams(null, null), []);

  const { data, isFetching } = useMicroworkflowDetailsQuery(
    { ...queryParams, userEmail: selectedUserEmail },
    { enabled: true },
  );

  return isFetching ? <Loader /> : <div>{JSON.stringify({ data, isAnalyzerEnabled })}</div>;
}
