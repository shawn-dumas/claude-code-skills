// Level 2 of a star re-export chain.
// star-chain-level1.ts does: export * from './star-chain-level2'
// This file does: export * from './reexport-chain-source'
// This exercises the recursive resolveStarExports call (lines 730-734 in ast-imports.ts):
// when processing star-chain-level1.ts, resolveStarExports opens this file and finds
// ANOTHER export *, triggering the recursive call.
export * from './reexport-chain-source';
