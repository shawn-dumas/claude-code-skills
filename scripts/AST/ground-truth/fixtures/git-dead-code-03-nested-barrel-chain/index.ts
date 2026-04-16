/**
 * Stripped from src/shared/types/index.ts
 * Barrel re-exports only the actively-used symbols.
 * InternalConfig, DeprecatedPageSize, LegacyDialogProps are NOT re-exported.
 */
export { Environment } from './common';
export type { RuleOption } from './common';

export { PageSizeValue } from './table';

export type { ModalState, TableSelection } from './ui';
