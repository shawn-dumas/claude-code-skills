/**
 * Consumer B -- uses ModalState and TableSelection through barrel.
 */
import type { ModalState, TableSelection } from './index';

function useModal(): ModalState {
  return {
    isOpen: false,
    setOpen: () => {},
    onSubmit: () => {},
    isPending: false,
  };
}

function getSelection(): TableSelection<string> {
  return {
    selectedRows: [],
    state: {},
    onChange: () => {},
  };
}
