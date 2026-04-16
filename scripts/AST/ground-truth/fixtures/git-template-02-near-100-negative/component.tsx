import { PageSizeValue, Table } from '@/components/8flow/Table';
import { useSettingsEntityColumns } from './useSettingsEntityColumns';
import { Loader, Button, SelectedItemsSummary } from '@/shared/ui';
import { SearchForm } from '@/components/8flow/SearchForm';
import { pluralize } from '@/shared/utils';
import { DeleteModal, TextInputModal } from '@/components/8flow/modals';
import { SettingsPageIds } from '@/constants/testIds';
import type { Group } from '@/shared/types/bpo-projects';
import type { ModalState, TableSelection } from '@/shared/types';
import type { SettingsEntityConfig } from './types';

interface Props {
  config: SettingsEntityConfig;
  entities: Group[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  entitiesToDisplay: Group[];
  selection: TableSelection<Group>;
  onSearchChange: (value: string) => void;
  createModal: ModalState<string>;
  editModal: ModalState<string>;
  deleteModal: ModalState;
}

export function SettingsEntityBlock({
  config,
  entities,
  isLoading,
  isFetching,
  entitiesToDisplay,
  selection,
  onSearchChange,
  createModal,
  editModal,
  deleteModal,
}: Props) {
  const columns = useSettingsEntityColumns(config.entityName);

  return (
    <div data-testid={config.testIdPanel} className='space-y-6'>
      <div className='mb-4 sm:flex sm:justify-between sm:items-center md:mb-2'>
        <div>
          <h1 className='text-2xl font-bold md:text-3xl text-slate-800'>
            {config.entityName} {entities ? `(${entities?.length ?? 0})` : ''}
          </h1>
        </div>
        <div className='flex justify-end items-center space-x-2.5'>
          <SelectedItemsSummary count={selection.selectedRows?.length} />
          <SearchForm onChange={onSearchChange} posthogProperties={{ table_name: config.entityNamePlural }} />
          <Button
            data-testid={SettingsPageIds.DELETE_BPO_PROJECT_BUTTON}
            posthogConfig={{ button_name: config.posthogButtonNames.remove }}
            variant='outlined'
            colorscheme='red'
            disabled={selection.selectedRows?.length === 0}
            onClick={() => deleteModal.setOpen(true)}
          >
            Remove
          </Button>
          <Button
            data-testid={SettingsPageIds.EDIT_BPO_PROJECT_BUTTON}
            posthogConfig={{ button_name: config.posthogButtonNames.edit }}
            variant='outlined'
            disabled={selection.selectedRows?.length !== 1}
            onClick={() => editModal.setOpen(true)}
          >
            Edit
          </Button>
          <Button
            data-testid={SettingsPageIds.ADD_BPO_PROJECT_BUTTON}
            posthogConfig={{ button_name: config.posthogButtonNames.add }}
            variant='outlined'
            onClick={() => createModal.setOpen(true)}
          >
            <div className='flex items-center'>
              <div className='text-lg mb-0.5'>&#43;</div>
              <div className='ml-2 w-[70px]'>Add {config.entityName}</div>
            </div>
          </Button>
        </div>
      </div>

      {isLoading || isFetching ? (
        <div className='flex items-center justify-center h-[100px]'>
          <Loader />
        </div>
      ) : (
        <Table
          enablePosthog
          autoHeight
          pageSize={PageSizeValue.LARGE}
          name={config.entityNamePlural}
          columns={columns}
          data={entitiesToDisplay ?? []}
          rowSelectionState={selection.state}
          onRowSelectionChange={selection.onChange}
        />
      )}

      <TextInputModal
        title={`Add ${config.entityName}`}
        label={`${config.entityName} Name`}
        placeholder='Enter a name'
        inputTestId={SettingsPageIds.BPO_PROJECT_NAME_INPUT}
        isOpen={createModal.isOpen}
        setIsOpen={createModal.setOpen}
        onCancel={() => createModal.setOpen(false)}
        onSubmit={createModal.onSubmit}
        isLoading={createModal.isPending}
      />

      <TextInputModal
        title={`Edit ${config.entityName}`}
        label={`${config.entityName} Name`}
        placeholder='Enter a name'
        inputTestId={SettingsPageIds.BPO_PROJECT_NAME_INPUT}
        value={selection.selectedRows?.[0]?.name}
        isOpen={editModal.isOpen}
        setIsOpen={editModal.setOpen}
        onCancel={() => editModal.setOpen(false)}
        onSubmit={editModal.onSubmit}
        isLoading={editModal.isPending}
      />

      <DeleteModal
        title={pluralize(selection.selectedRows?.length, `Remove ${config.entityName}`)}
        isOpen={deleteModal.isOpen}
        setIsOpen={deleteModal.setOpen}
        onCancel={() => deleteModal.setOpen(false)}
        onDelete={deleteModal.onSubmit}
        isDeleting={deleteModal.isPending}
      />
    </div>
  );
}
