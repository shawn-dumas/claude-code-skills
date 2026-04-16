import { Dispatch, SetStateAction, useState } from 'react';
import { RowSelectionState } from '@tanstack/react-table';
import { useUsers } from '@/providers/context/usersContext';
import { UserPanel } from '@/page_blocks/users/UserPanel';
import { SearchForm } from '@/components/8flow/SearchForm';
import { SelectedItemsSummary } from '@/shared/ui';
import { MappedUser } from '@/services/hooks/queries/users';
import { EditUserModal } from './EditUserModal';
import { EditAssignmentModal } from '@/components/8flow/modals/EditAssignmentModal';
import { EditAssignmentModalValues } from '@/components/8flow/modals/EditAssignmentModal/validation';
import { isAdmin, pluralize } from '@/shared/utils';
import {
  useAssignUsersMutation as useAssignUsers,
  useAssignUsersToProjectsMutation as useAssignUsersToProjects,
} from '@/services/hooks/mutations/bpo-projects';
import { useFlyoutContext } from '@/providers/context/flyoutContext';
import { toastSuccess } from '@/components/8flow/Toast';
import { UsersTable } from './UsersTable';
import { TeamUsersActions } from './TeamUsersActions';
import { Role } from '@/types';

type EditAssignmentType = 'single' | 'multiple';

interface UsersProps {
  teamId?: number;
  roles: Role[];
  users: MappedUser[] | undefined;
  isFetchingUsers: boolean;
  usersToDisplay: MappedUser[] | undefined;
  selectedRows: MappedUser[];
  selectionState: RowSelectionState;
  onSelectionChange: Dispatch<SetStateAction<RowSelectionState>>;
  clearSelection: () => void;
  bpoItems: { label: string; id: string }[];
  projectItems: { label: string; id: string }[];
  onSearchChange: (value: string | null) => void;
}

export const Users = ({
  teamId,
  roles,
  users,
  isFetchingUsers,
  usersToDisplay,
  selectedRows,
  selectionState,
  onSelectionChange,
  clearSelection,
  bpoItems,
  projectItems,
  onSearchChange,
}: UsersProps) => {
  const tableName = teamId ? 'Team Users' : 'Users';

  const { selectedUser } = useUsers();
  const { setFlyoutOpen } = useFlyoutContext();

  const [editUserModalOpen, setEditUserModalOpen] = useState<boolean>(false);
  const [editAssignmentsModalOpen, setEditAssignmentsModalOpen] = useState(false);
  const [editAssignmentType, setEditAssignmentType] = useState<EditAssignmentType>('multiple');

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
              <SearchForm onChange={onSearchChange} posthogProperties={{ table_name: tableName }} />
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
          onRowSelectionChange={onSelectionChange}
        />
      </div>

      <EditUserModal
        title='Edit User'
        isOpen={editUserModalOpen}
        setIsOpen={setEditUserModalOpen}
        bposItems={bpoItems}
        projectsItems={projectItems}
      />
      <EditAssignmentModal
        title='Edit Assignment'
        bposItems={bpoItems}
        projectsItems={projectItems}
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
