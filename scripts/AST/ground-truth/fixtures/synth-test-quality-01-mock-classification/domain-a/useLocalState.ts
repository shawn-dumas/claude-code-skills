import { useState } from 'react';

export function useLocalState(initial: number) {
  const [count, setCount] = useState(initial);
  return { count, setCount };
}
