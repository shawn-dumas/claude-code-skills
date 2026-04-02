// Has a local re-export (export { name }) with no 'from' clause.
// Also has a local export with a 'from' clause for contrast.
// Exercises the !moduleSpecifier branch in collectReexportEntries,
// markReexportedNames, and extractReexportImports.

const localValue = 42;
const anotherLocal = 'hello';

export { localValue, anotherLocal };
export { Button } from './simple-component';
