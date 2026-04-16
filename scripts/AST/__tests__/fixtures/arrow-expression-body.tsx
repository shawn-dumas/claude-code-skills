/* eslint-disable */
/**
 * Fixture: arrow function component with expression body (no block).
 *
 * Covers two uncovered branches in findReturnStatementLines:
 *
 * 1. Arrow function with expression body (no block): getBody() returns null,
 *    and the Node.isArrowFunction branch returns the body's line range.
 *    Lines 1204-1213 in ast-react-inventory.ts.
 *
 * 2. Function with a block body but no top-level return statement: the loop
 *    over statements finds no ReturnStatement and falls through to the
 *    final { start: 0, end: 0 } return. Line 1228 in ast-react-inventory.ts.
 */
import React from 'react';

interface BadgeProps {
  label: string;
}

// Arrow component with expression body (no block, no explicit return keyword).
// findReturnStatementLines: getBody() returns null, Node.isArrowFunction check
// fires and returns the expression body's line range.
export const Badge = ({ label }: BadgeProps) => <span>{label}</span>;

// Function component with a block body but no top-level return statement.
// JSX exists inside a variable (so containsJsx detects it), but there is no
// return statement at the top level of the function body.
// findReturnStatementLines: loop finds no ReturnStatement, returns { 0, 0 }.
export function NoReturn({ val }: { val: string }) {
  const el = <span>{val}</span>;
  void el;
}
