import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Negative test cases for effect observation extraction.
// These components should NOT trigger certain effect observations,
// verifying that the observation layer correctly identifies what it can
// structurally observe and what it cannot.
// ---------------------------------------------------------------------------

// 1. Helper function that wraps fetch -- should the observation
//    be on the helper call or the fetch call?
function useFetchWrapper() {
  return { refetch: () => fetch('/api/data') };
}

export function IndirectFetch() {
  const { refetch } = useFetchWrapper();
  useEffect(() => {
    refetch(); // NOT a direct fetch call -- should NOT emit EFFECT_FETCH_CALL
  }, [refetch]);
  return <div />;
}

// 2. setState in a nested callback inside an effect -- still counts
export function NestedSetState() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(d => setData(d)); // SHOULD emit EFFECT_STATE_SETTER_CALL
  }, []);
  return <div>{String(data)}</div>;
}

// 3. Variable named 'localStorage' that shadows the global
export function ShadowedStorage() {
  const localStorage = { getItem: (_key: string) => null };
  useEffect(() => {
    localStorage.getItem('key'); // Should emit EFFECT_STORAGE_CALL
    // Note: The AST tool cannot distinguish shadowed variables from globals
    // without full scope analysis. This is a known limitation.
  }, [localStorage]);
  return <div />;
}

// 4. Timer in a non-effect context (should NOT be an effect observation)
export function TimerOutsideEffect() {
  const handleClick = () => {
    setTimeout(() => console.log('click'), 100);
  };
  return <button onClick={handleClick}>click</button>;
}

// 5. Ref access that is NOT inside an effect
export function RefOutsideEffect() {
  const ref = useRef<HTMLDivElement>(null);
  const measure = () => {
    if (ref.current) {
      console.log(ref.current.offsetHeight);
    }
  };
  return <div ref={ref} onClick={measure} />;
}

// 6. useEffect with no body statements (empty effect)
export function EmptyEffect() {
  useEffect(() => {}, []);
  return <div />;
}

// 7. Aliased setter -- `const update = setCount`
export function AliasedSetter() {
  const [count, setCount] = useState(0);
  const update = setCount;
  useEffect(() => {
    update(1); // This IS a state setter call (aliased)
    // Known limitation: aliased setters are not tracked unless we resolve
    // the alias, which requires data flow analysis beyond structural AST.
  }, [update]);
  return <div>{count}</div>;
}

// 8. useLayoutEffect (should also be detected)
export function LayoutEffect() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = 0;
    }
  }, []);
  return <div ref={ref} />;
}

// 9. Async effect callback
export function AsyncEffect() {
  const [data, setData] = useState<unknown>(null);
  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/data');
      const json = await res.json();
      setData(json);
    };
    void load();
  }, []);
  return <div>{String(data)}</div>;
}

// 10. DOM API calls inside effect
export function DomApiEffect() {
  useEffect(() => {
    const handler = () => console.log('resize');
    window.addEventListener('resize', handler);
    return () => {
      window.removeEventListener('resize', handler);
    };
  }, []);
  return <div />;
}
