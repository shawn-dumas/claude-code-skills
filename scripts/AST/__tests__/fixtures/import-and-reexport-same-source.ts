// Has both a regular import and a re-export from the same source module.
// This exercises the mergeImportEntry path in extractImportObservationsFromSource
// where ri.source already exists in allImports.
import { Button } from './simple-component';
export { Button } from './simple-component';

export function wrapButton(): typeof Button {
  return Button;
}
