// Fixture for ast-export-surface classifyExportKind fallback (line 63).
// A namespace declaration is not a FunctionDeclaration, ClassDeclaration,
// TypeAliasDeclaration, InterfaceDeclaration, EnumDeclaration, or VariableDeclaration.
// It falls through to the final `return 'const'` fallback.

export namespace Utils {
  export const VERSION = '1.0';
  export function helper(): void {}
}
