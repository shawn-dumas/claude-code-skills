/* eslint-disable */
// Fixture: edge-case patterns for ast-number-format coverage.
// Each section exercises an uncovered branch.

import React from 'react';

declare function formatNumber(value: number, decimals?: number): string;
declare function someWrapper(s: string): void;
declare function customRound(x: number): number;

// Line 43 coverage: formatNumber passed as an argument to another call.
// getNodeContext: parent of formatNumber(...) is a CallExpression → 'argument'.
function exampleFormatAsArgument(value: number) {
  someWrapper(formatNumber(value));
}

// Line 48 coverage: formatNumber inside a JSX expression.
// getNodeContext: parent of formatNumber(...) is a JsxExpression → 'jsx-attribute'.
function ExampleJsxFormat({ value }: { value: number }) {
  return <div>{formatNumber(value)}</div>;
}

// Line 71 coverage: toFixed called with a variable (not a NumericLiteral).
// parseNumericArg receives an Identifier → returns undefined.
function exampleToFixedVariable(num: number, places: number) {
  return num.toFixed(places);
}

// Lines 288-290 coverage: template literal with bare identifier call ending in %.
// The callee of the CallExpression is a plain Identifier (not PropertyAccess),
// so the else-if branch for Identifier is taken, setting callee = 'customRound'.
function exampleBareCallInPercent(value: number) {
  return `${customRound(value)}%`;
}

export { exampleFormatAsArgument, ExampleJsxFormat, exampleToFixedVariable, exampleBareCallInPercent };
