import { Loader, MetricsDisplay, PlaceholderContainer, Switch } from '@/shared/ui';
import { useMemo } from 'react';
import { opportunityKpiItems } from './constants';
import { MicroworkflowsTable } from './MicroworkflowsTable';
import { MicroworkflowsByUserTableContainer } from './MicroworkflowsByUserTable';
import { SELECT_TEAMS_OR_WS_MESSAGE } from '../constants';
import { MicroworkflowDetailsContainer } from './MicroworkflowDetailsTable';
import { AppPosthogEvent } from '@/shared/lib/posthog';
import type { Filters } from '@/shared/types/insightsFilters';
import type {
  MappedGetMicroworkflowsResponse,
  MappedMicroworkflowData,
  MicroWorkflowsByUser,
} from '@/shared/types/microworkflows';

interface Props {
  opportunitiesFilters: Filters['opportunities'];
  selectedMicroworkflow: MappedMicroworkflowData | null;
  onSelectMicroworkflow: (value: MappedMicroworkflowData | null) => void;
  selectedMicroworkflowUserEmail: string | null;
  onSelectMicroworkflowUser: (value: MicroWorkflowsByUser | null) => void;
  isOutOfChromeFiltered: boolean;
  onToggleOutOfChromeFiltered: (value: boolean) => void;
  data: MappedGetMicroworkflowsResponse | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  enabled: boolean;
  isAnalyzerEnabled: boolean;
  onNavigateToWorkstreamAnalyzer: (workstream: string) => void;
}

export function OpportunityBlock({
  opportunitiesFilters,
  selectedMicroworkflow,
  onSelectMicroworkflow,
  selectedMicroworkflowUserEmail,
  onSelectMicroworkflowUser,
  isOutOfChromeFiltered,
  onToggleOutOfChromeFiltered,
  data,
  isLoading,
  isFetching,
  isFetched,
  enabled,
  isAnalyzerEnabled,
  onNavigateToWorkstreamAnalyzer,
}: Props) {
  const { data: microworkflows, summary } = data ?? {};

  const filteredData = useMemo(
    () => microworkflows?.filter(item => (isOutOfChromeFiltered ? !!item.opportunityType : true)),
    [microworkflows, isOutOfChromeFiltered],
  );

  const handleToggleOutOfChrome = () => {
    onSelectMicroworkflow(null);
    onSelectMicroworkflowUser(null);
    onToggleOutOfChromeFiltered(!isOutOfChromeFiltered);
  };

  return (
    <PlaceholderContainer disabled={!enabled}>
      <main className='flex flex-col bg-white rounded-lg shadow-xs border border-gray-200 h-full'>
        <div className='shrink-0 border-b border-gray-200 flex items-center justify-end px-6'>
          <div className='flex justify-end items-center gap-6'>
            <div className='flex items-center gap-2 pr-4 border-r border-gray-200'>
              <span className='text-xs font-medium text-gray-600'>Hide Out of Chrome</span>

              <Switch
                posthogEventName={AppPosthogEvent.OUT_OF_CHROME_TOGGLE}
                name='hide-out-of-chrome'
                checked={isOutOfChromeFiltered}
                onChange={handleToggleOutOfChrome}
                disabled={!enabled}
              />
            </div>

            <div className='max-w-[40dvw] xl:max-w-[45dvw] min-w-[400px]'>
              <MetricsDisplay items={opportunityKpiItems} data={summary} isLoading={isLoading || isFetching} />
            </div>
          </div>
        </div>
        <section className='flex-1 min-h-0 p-6 bg-gray-50 overflow-auto'>
          {isLoading || isFetching ? (
            <div className='flex items-center justify-center'>
              <Loader />
            </div>
          ) : (
            <MicroworkflowsTable
              microworkflows={filteredData}
              summary={summary}
              placeholder={isFetched ? undefined : SELECT_TEAMS_OR_WS_MESSAGE}
              selectedMicroworkflow={selectedMicroworkflow}
              onSelectMicroworkflow={onSelectMicroworkflow}
              onClearMicroworkflowUser={() => onSelectMicroworkflowUser(null)}
            />
          )}
          {selectedMicroworkflow && (
            <MicroworkflowsByUserTableContainer
              selectedMicroworkflow={selectedMicroworkflow}
              opportunitiesFilters={opportunitiesFilters}
              selectedUserEmail={selectedMicroworkflowUserEmail}
              onSelectUser={onSelectMicroworkflowUser}
            />
          )}
          {selectedMicroworkflow && selectedMicroworkflowUserEmail && (
            <MicroworkflowDetailsContainer
              selectedMicroworkflow={selectedMicroworkflow}
              selectedUserEmail={selectedMicroworkflowUserEmail}
              opportunitiesFilters={opportunitiesFilters}
              isAnalyzerEnabled={isAnalyzerEnabled}
              onNavigateToWorkstreamAnalyzer={onNavigateToWorkstreamAnalyzer}
            />
          )}
        </section>
      </main>
    </PlaceholderContainer>
  );
}
