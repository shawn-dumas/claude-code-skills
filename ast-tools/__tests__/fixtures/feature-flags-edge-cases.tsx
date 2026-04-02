/* eslint-disable */
// Fixture: edge-case patterns for ast-feature-flags coverage.

declare function usePosthogContext(): { featureFlags: Record<string, boolean> };

// Line 357 coverage: usePosthogContext() called as a standalone expression (not in a
// variable declaration). The parent is NOT a VariableDeclaration, so the tool
// returns early at line 357 without emitting a FLAG_HOOK_CALL observation.
function ComponentWithBarePosthogCall() {
  usePosthogContext();
  return null;
}

// Line 299 coverage: a featureFlags property access displayed bare in JSX.
// isInsideJsxConditional walks up to the JsxExpression, finds the expression is
// a PropertyAccessExpression (not ternary or &&), and returns false at line 299.
declare function useFeatureFlags(): Record<string, boolean>;
function ComponentWithBareFlag() {
  const featureFlags = useFeatureFlags();
  // Bare flag read inside JSX — not a conditional render.
  return <div>{String(featureFlags.some_flag)}</div>;
}

export { ComponentWithBarePosthogCall, ComponentWithBareFlag };
