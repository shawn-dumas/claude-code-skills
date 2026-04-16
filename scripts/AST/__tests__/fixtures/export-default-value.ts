// Has an ExportAssignment (export default expr).
// Exercises rawCollectDirectExportNames ExportAssignment branch (line 534),
// rawExtractExports ExportAssignment branch (line 823),
// and resolveNamedExportKind ExportAssignment branch (line 611).

export default 42;
export const named = 'also exported';
