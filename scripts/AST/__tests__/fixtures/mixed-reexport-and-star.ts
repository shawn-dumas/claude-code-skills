// Has both a named re-export (for something unrelated) and a star re-export.
// When resolveNamedExportKind looks for 'chainedFunction' in this file,
// it won't find it in the named re-exports section (line 647-663),
// so it proceeds to the star re-export section (line 667-675).
// Line 670 fires to skip the named re-export statement (it has an exportClause).
import type { ButtonProps } from './simple-component';
export { ButtonProps } from './simple-component';
export * from './reexport-chain-source';
