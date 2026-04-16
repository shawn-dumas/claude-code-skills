// Pure-TS custom hook fixture (no JSX return). Exists to verify that
// ast-react-inventory emits observations for useEffect / useMemo /
// useCallback / useLayoutEffect inside a hook body that `detectComponents`
// would otherwise skip (PascalCase + containsJsx gate).
//
// Modeled after real call sites the Phase 3 FSM audit missed:
//   - src/ui/page_blocks/dashboard/chat/useTypewriter.ts
//   - src/ui/page_blocks/dashboard/team/useProductivityByDateData.ts
//   - src/ui/providers/context/auth/hooks/useAuthStateObserver.ts
//   - src/ui/providers/context/auth/hooks/useSessionModal.ts

import { useState, useEffect, useMemo, useCallback, useLayoutEffect, useRef } from 'react';

export function useExampleHook(text: string) {
  const [count, setCount] = useState(0);
  const ref = useRef<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setCount(c => c + 1), 100);
    return () => clearTimeout(id);
  }, [text]);

  useLayoutEffect(() => {
    ref.current = count;
  }, [count]);

  const double = useMemo(() => count * 2, [count]);

  const increment = useCallback(() => setCount(c => c + 1), []);

  return { count, double, increment };
}

export const useArrowHook = (label: string) => {
  const [value, setValue] = useState(label);

  useEffect(() => {
    setValue(label.toUpperCase());
  }, [label]);

  return value;
};
