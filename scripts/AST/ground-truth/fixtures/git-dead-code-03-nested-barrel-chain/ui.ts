/**
 * Stripped from src/shared/types/ui.ts
 * ModalState is consumed. TableSelection is consumed.
 * LegacyDialogProps is dead.
 */
export interface ModalState<T = void> {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  onSubmit: T extends void ? () => void : (value: T) => void;
  isPending: boolean;
}

export interface TableSelection<T> {
  selectedRows: T[];
  state: Record<string, boolean>;
  onChange: (state: Record<string, boolean>) => void;
  clear?: () => void;
}

/** Dead type -- was part of old dialog system, fully replaced */
export interface LegacyDialogProps {
  title: string;
  visible: boolean;
  onDismiss: () => void;
}
