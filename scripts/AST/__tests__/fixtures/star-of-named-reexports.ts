// Star re-export of a file that itself has named re-exports.
// When resolveStarExports processes reexport-chain-middle.ts, it finds
// entries with kind='reexport' (chainedFunction, ChainedType, default).
// The inner loop (lines 709-724) then resolves them to their source kinds.
// Also exercises the recursive star re-export path (lines 730-734) because
// reexport-chain-middle.ts doesn't have export * but after direct chain resolution
// the named exports should be properly resolved.
export * from './reexport-chain-middle';
