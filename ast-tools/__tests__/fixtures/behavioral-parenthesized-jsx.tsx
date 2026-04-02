import { useState } from 'react';

/**
 * Fixture: Behavioral patterns that exercise uncovered branches in ast-behavioral.ts.
 *
 * Covers:
 * - && guard with parenthesized JsxSelfClosingElement (lines 163-169, JsxSelfClosingElement path)
 * - && guard with parenthesized JsxFragment (lines 163-169, JsxFragment path)
 * - Ternary where whenTrue wraps JSX in parentheses (lines 196-207, forEachDescendant path)
 * - STATE_INITIALIZATION where name binding is a plain identifier not array destructuring (lines 365-366)
 * - RENDER_CAP from .slice(0, N) with numeric literal second arg (line 90)
 * - JSX_STRING_LITERAL via JsxExpression containing string literal (lines 265-267)
 */

type Props = {
  show?: boolean;
  count?: number;
  items?: string[];
};

export function ParenthesizedGuardComponent({ show = false, count = 0, items = [] }: Props) {
  // STATE_INITIALIZATION with plain identifier binding (not destructured array)
  // Covers line 365-366: Node.isIdentifier(nameNode) branch
  const stateResult = useState(42);

  // RENDER_CAP with numeric literal: .slice(0, 5)
  // Covers line 90: both args are numeric literals (0 and 5)
  const capped = items.slice(0, 5);

  // && guard where right is ParenthesizedExpression containing JsxSelfClosingElement
  // Covers line 165: ck === SyntaxKind.JsxSelfClosingElement inside forEachDescendant
  const selfClosingGuard = show && <input type='text' defaultValue='test' />;

  // && guard where right is ParenthesizedExpression containing JsxFragment
  // Covers line 166: ck === SyntaxKind.JsxFragment inside forEachDescendant
  const fragmentGuard = count > 0 && (
    <>
      <span>First fragment child</span>
      <span>Second fragment child</span>
    </>
  );

  // Ternary where whenTrue is a ParenthesizedExpression wrapping a JsxElement
  // The JSX is NOT directly a JsxElement node but a ParenthesizedExpression,
  // so hasJsxBranch must use forEachDescendant (lines 196-207)
  const wrappedTernary = show ? <span>Wrapped true branch</span> : null;

  return (
    <div>
      {/* JSX_STRING_LITERAL via JsxExpression with string literal (lines 265-267) */}
      {'Static string content'}
      {selfClosingGuard}
      {fragmentGuard}
      {wrappedTernary}
      <span>{stateResult[0]}</span>
      <span>{capped.join(', ')}</span>
    </div>
  );
}
