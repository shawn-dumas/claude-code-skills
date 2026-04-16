import React, { useState, useMemo } from 'react';
import { useUsers } from '@/providers/context/usersContext';
import { useUsersListQuery } from '@/services/hooks/queries/users';
import { UserPanel } from '@/page_blocks/users/UserPanel';
import { SearchForm } from '@/components/8flow/SearchForm';
import { SelectedItemsSummary } from '@/shared/ui';
import { User } from '@/providers/context/usersContext/types';
import { EditUserModal } from './EditUserModal';
import { EditAssignmentModal } from '@/components/8flow/modals/EditAssignmentModal';
import { EditAssignmentModalValues } from '@/components/8flow/modals/EditAssignmentModal/validation';
import { isStringMatch, isAdmin, pluralize } from '@/shared/utils';
import { useKeepRowsSelection } from '@/shared/hooks';
import {
  useGetAllBPOsQuery as useGetAllBPOs,
  useGetAllProjectsQuery as useGetAllProjects,
} from '@/services/hooks/queries/bpo-projects';
import {
  useAssignUsersMutation as useAssignUsers,
  useAssignUsersToProjectsMutation as useAssignUsersToProjects,
} from '@/services/hooks/mutations/bpo-projects';
import { useFlyoutContext } from '@/providers/context/flyoutContext';
import { useAuthState } from '@/providers/context/auth';
import { toastSuccess } from '@/components/8flow/Toast';
import { UsersTable } from './UsersTable';
import { TeamUsersActions } from './TeamUsersActions';

type EditAssignmentType = 'single' | 'multiple';

interface UsersProps {
  teamId?: number;
}

export const Users = ({ teamId }: UsersProps) => {
  const tableName = teamId ? 'Team Users' : 'Users';

  const { roles } = useAuthState();
  const { selectedUser } = useUsers();
  const { setFlyoutOpen } = useFlyoutContext();

  const { data: users, isFetching: isFetchingUsers } = useUsersListQuery(teamId, {
    staleTime: 0,
    refetchOnMount: true,
  });
  const { data: bpos } = useGetAllBPOs();
  const { data: projects } = useGetAllProjects();

  const [searchInput, setSearchInput] = useState<string | null>(null);
  const [editUserModalOpen, setEditUserModalOpen] = useState<boolean>(false);
  const [editAssignmentsModalOpen, setEditAssignmentsModalOpen] = useState(false);
  const [editAssignmentType, setEditAssignmentType] = useState<EditAssignmentType>('multiple');

  const usersToDisplay = useMemo(() => {
    if (searchInput?.trim()) {
      return users?.filter(
        (selectedUser: User) =>
          isStringMatch(searchInput, selectedUser.email) || isStringMatch(searchInput, selectedUser.name),
      );
    }

    return users;
  }, [users, searchInput]);

  const { selectedRows, selectionState, setSelectionState, clearSelection } = useKeepRowsSelection(
    usersToDisplay ?? [],
    'uid',
  );

  const { mutateAsync: assignUsers, isPending: isAssigningUsers } = useAssignUsers({
    onSuccess: () => {
      toastSuccess(`${pluralize(selectedRows?.length, 'Assignment')} updated successfully`);
    },
  });
  const { mutateAsync: assignUsersToProjects, isPending: isAssigningUsersToProjects } = useAssignUsersToProjects({
    onSuccess: () => {
      toastSuccess(`${pluralize(selectedRows?.length, 'Project assignment')} updated successfully`);
    },
  });

  const handleOpenEditAssignment = (type: EditAssignmentType) => {
    setEditAssignmentType(type);
    setEditAssignmentsModalOpen(true);
  };

  const handleEditAssignments = async ({ bpos, projects }: EditAssignmentModalValues) => {
    const userIds =
      editAssignmentType === 'single' && selectedUser
        ? [selectedUser?.uid]
        : selectedRows.map(selectedUser => selectedUser.uid);

    if (isAdmin(roles)) {
      const assignments = [...bpos, ...projects].map(groupId => ({ groupId: Number(groupId) }));
      await assignUsers({ userIds, assignments });
    } else {
      await assignUsersToProjects({ userIds, projectIds: projects.map(Number) });
    }

    setEditAssignmentsModalOpen(false);
    setFlyoutOpen(false);
    clearSelection();
  };

  const bpoItems = useMemo(
    () =>
      bpos?.map(bpo => ({
        label: bpo.name,
        id: String(bpo.id),
      })),
    [bpos],
  );

  const projectItems = useMemo(
    () =>
      projects?.map(project => ({
        label: project.name,
        id: String(project.id),
      })),
    [projects],
  );

  return (
    <>
      <div className='space-y-5'>
        <div className='sm:flex-wrap sm:flex sm:justify-between sm:items-center'>
          <div className='mb-4 sm:mb-0'>
            <h1 className='text-2xl font-bold text-slate-800 whitespace-nowrap'>Users ({usersToDisplay?.length})</h1>
          </div>
          <div className='grid justify-start grid-flow-col gap-2 sm:auto-cols-max sm:justify-end'>
            <div className='flex items-center gap-2'>
              <SelectedItemsSummary count={selectedRows?.length} />
              <SearchForm
                onChange={value => setSearchInput(value || null)}
                posthogProperties={{ table_name: tableName }}
              />
              {teamId && (
                <TeamUsersActions
                  teamId={teamId}
                  selectedRows={selectedRows}
                  users={users}
                  clearSelection={clearSelection}
                  onOpenEditAssignment={handleOpenEditAssignment}
                />
              )}
            </div>
          </div>
        </div>

        <UsersTable
          isLoading={isFetchingUsers}
          name={tableName}
          data={usersToDisplay ?? []}
          teamId={teamId}
          enableSelect={!!teamId}
          rowSelectionState={selectionState}
          onRowSelectionChange={setSelectionState}
        />
      </div>

      <EditUserModal
        title='Edit User'
        isOpen={editUserModalOpen}
        setIsOpen={setEditUserModalOpen}
        bposItems={bpoItems ?? []}
        projectsItems={projectItems ?? []}
      />
      <EditAssignmentModal
        title='Edit Assignment'
        bposItems={bpoItems ?? []}
        projectsItems={projectItems ?? []}
        selectedUsers={editAssignmentType === 'single' && selectedUser ? [selectedUser] : selectedRows}
        isOpen={editAssignmentsModalOpen}
        setIsOpen={setEditAssignmentsModalOpen}
        isLoading={isAssigningUsers || isAssigningUsersToProjects}
        onSubmit={handleEditAssignments}
      />
      <UserPanel
        editUserModalOpen={editUserModalOpen}
        onEditUser={() => setEditUserModalOpen(true)}
        onEditAssignment={() => handleOpenEditAssignment('single')}
      />
    </>
  );
};
