// Re-exports chainedFunction from the mixed re-export file.
// When buildDependencyGraph processes this file, it calls resolveNamedExportKind
// to find 'chainedFunction' in mixed-reexport-and-star.ts. Since chainedFunction
// is only available via export * there (not a named re-export), resolveNamedExportKind
// will reach the star re-export loop and trigger line 670 (skip named re-export stmt).
export { chainedFunction } from './mixed-reexport-and-star';
