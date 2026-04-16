// Part of a circular re-export chain for testing traceBarrelChain's visited-set guard.
// circular-reexport-a re-exports from circular-reexport-b, and b re-exports from a.
export { circularB } from './circular-reexport-b';
export const circularA = 'from-a';
