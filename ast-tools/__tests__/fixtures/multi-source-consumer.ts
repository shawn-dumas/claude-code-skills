// Imports from multiple sources to exercise the resolvedPath !== filePath branch
// in consumerImportsName (line 1235 in ast-imports.ts). When checking if this file
// consumes a specific export from dead-export.ts, the loop iterates both imports;
// the simple-component import hits the 'resolvedPath !== filePath' false return.
import { usedFunction } from './dead-export';
import { Button } from './simple-component';

export function multiConsumer(): string {
  return usedFunction() + Button.toString();
}
