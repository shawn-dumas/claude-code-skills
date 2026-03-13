/**
 * Negative fixture for hook classification observations.
 * Tests edge cases where hook detection/classification might go wrong.
 */

import React, { useId, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useCustomThing } from '@/services/hooks/queries/custom';

// 1. Hook named useQuery that is NOT from TanStack
// This is a local function, not the TanStack hook
function useQuery(sql: string) {
  return sql;
}

export function LocalUseQuery() {
  const result = useQuery('SELECT * FROM users');
  // HOOK_CALL observation with importSource = undefined (local)
  // NOT from @tanstack/react-query
  return <div>{result}</div>;
}

// 2. Function starting with 'use' that is too short (useId exception)
export function UseIdComponent() {
  const id = useId(); // isReactBuiltin: true
  return <div id={id}>content</div>;
}

// 3. Function named 'use' + lowercase (not a hook)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function useful(x: number) {
  return x + 1;
}

// This should NOT detect 'useful' as a hook
export function NotAHookComponent() {
  // useful(5) is a regular function call, not a hook
  const x = 5;
  return <div>{x}</div>;
}

// 4. Hook imported from services/hooks/ but with an unusual name
export function CustomServiceHook() {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const data = useCustomThing();
  // HOOK_CALL with importSource containing 'services/hooks'
  // The observation records this; the interpreter classifies it
  return <div>{String(data)}</div>;
}

// 5. Component with no props
export function NoPropComponent() {
  return <div>hello</div>;
  // COMPONENT_DECLARATION, no PROP_FIELD observations
}

// 6. Callback prop detection edge cases
type CallbackProps = {
  onClick: () => void; // isCallback: true (on[A-Z])
  transformer: (x: number) => string; // isCallback: true (=>)
  data: string; // isCallback: false
  processItems: (items: string[]) => string[]; // isCallback: true (=>)
};

export function CallbackPropsComponent({ onClick, transformer, data, processItems }: CallbackProps) {
  return (
    <button onClick={onClick}>
      {transformer(1)}
      {data}
      {processItems(['a', 'b']).join(', ')}
    </button>
  );
}

// 7. Hook with no destructuring
export function NoDestructuringHook() {
  const state = useState(0);
  // HOOK_CALL with destructuredNames: [] (not destructured)
  return <div>{String(state)}</div>;
}

// 8. Multiple hooks from same source
export function MultipleHooksComponent() {
  const [count] = useState(0);
  const [name] = useState('');
  // Two HOOK_CALL observations, both isReactBuiltin: true
  return (
    <div>
      {count}
      {name}
    </div>
  );
}
