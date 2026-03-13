// Negative fixture: below-threshold patterns that should emit observations
// but NOT appear in legacy violations.

// 1. Simple ternary (depth 1) -- below threshold
export function SimpleTernary({ show }: { show: boolean }) {
  return <div>{show ? <span>yes</span> : <span>no</span>}</div>;
  // JSX_TERNARY_CHAIN observation with depth: 1
  // Should NOT appear in legacy violations (threshold is 2)
}

// 2. className with one ternary (below threshold)
export function SimpleClassName({ active }: { active: boolean }) {
  return <div className={active ? 'active' : 'inactive'}>hello</div>;
  // JSX_COMPLEX_CLASSNAME observation with ternaryCount: 1
  // Should NOT appear in legacy violations (threshold is 2)
}

// 3. Event handler with one statement (below threshold)
export function OneLineHandler() {
  return <button onClick={() => console.log('click')}>click</button>;
  // JSX_INLINE_HANDLER observation with statementCount: 1
  // Should NOT appear in legacy violations (threshold is 2)
}

// 4. Array.map without chaining (below threshold)
export function SingleMap({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
  // JSX_TRANSFORM_CHAIN observation with chainLength: 1
  // Should NOT appear in legacy violations (threshold is 2)
}

// 5. Style prop with only static values (not computed)
export function StaticStyle() {
  return <div style={{ color: 'red', fontSize: '14px' }}>hello</div>;
  // JSX_INLINE_STYLE observation with hasComputedValues: false
  // Should NOT appear in legacy violations
}

// 6. Ternary in a non-JSX context (should NOT be observed)
export function NonJsxTernary({ x }: { x: number }) {
  const label = x > 0 ? 'positive' : 'negative';
  return <div>{label}</div>;
  // The ternary is NOT inside JSX return -- no JSX_TERNARY_CHAIN
}

// 7. Two-condition guard (below threshold of 3)
export function TwoConditionGuard({ isAdmin, isLoading }: { isAdmin: boolean; isLoading: boolean }) {
  return <div>{isAdmin && isLoading && <span>Admin loading</span>}</div>;
  // JSX_GUARD_CHAIN observation with conditionCount: 2
  // Should NOT appear in legacy violations (threshold is 3)
}
