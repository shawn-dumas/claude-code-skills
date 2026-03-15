import { useState, useMemo, useCallback } from 'react';
import { useAuthState } from '@/providers/context/auth';
import { useUsersListQuery, type MappedUser } from '@/services/hooks/queries/users';
import {
  useGetAllBPOsQuery as useGetAllBPOs,
  useGetAllProjectsQuery as useGetAllProjects,
} from '@/services/hooks/queries/bpo-projects';
import { useKeepRowsSelection } from '@/shared/hooks';
import { isStringMatch } from '@/shared/utils';
import { FlyoutProvider } from '@/providers/context/flyoutContext';
import { Users } from './Users';

interface Props {
  teamId?: number;
}

export const UsersContainer = ({ teamId }: Props) => {
  const { roles } = useAuthState();

  const { data: users, isFetching: isFetchingUsers } = useUsersListQuery(teamId, {
    staleTime: 0,
    refetchOnMount: true,
  });
  const { data: bpos } = useGetAllBPOs();
  const { data: projects } = useGetAllProjects();

  const [searchInput, setSearchInput] = useState<string | null>(null);

  const usersToDisplay = useMemo(() => {
    if (searchInput?.trim()) {
      return users?.filter(
        (user: MappedUser) => isStringMatch(searchInput, user.email) || isStringMatch(searchInput, user.name),
      );
    }
    return users;
  }, [users, searchInput]);

  const { selectedRows, selectionState, setSelectionState, clearSelection } = useKeepRowsSelection(
    usersToDisplay ?? [],
    'uid',
  );

  const bpoItems = useMemo(() => bpos?.map(bpo => ({ label: bpo.name, id: String(bpo.id) })), [bpos]);

  const projectItems = useMemo(
    () => projects?.map(project => ({ label: project.name, id: String(project.id) })),
    [projects],
  );

  const handleSearchChange = useCallback((value: string | null) => {
    setSearchInput(value ?? null);
  }, []);

  return (
    <FlyoutProvider>
      <Users
        teamId={teamId}
        roles={roles}
        users={users}
        isFetchingUsers={isFetchingUsers}
        usersToDisplay={usersToDisplay}
        selectedRows={selectedRows}
        selectionState={selectionState}
        onSelectionChange={setSelectionState}
        clearSelection={clearSelection}
        bpoItems={bpoItems ?? []}
        projectItems={projectItems ?? []}
        onSearchChange={handleSearchChange}
      />
    </FlyoutProvider>
  );
};
