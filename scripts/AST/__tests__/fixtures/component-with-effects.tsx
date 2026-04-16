import React, { useState, useEffect, useRef } from 'react';

interface TimerProps {
  initialCount: number;
  onTick: (count: number) => void;
}

export function Timer({ initialCount, onTick }: TimerProps) {
  const [count, setCount] = useState(initialCount);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Effect: derived state sync (anti-pattern -- should be useMemo or event handler)
  useEffect(() => {
    setCount(initialCount);
  }, [initialCount]);

  // Effect: DOM subscription with cleanup (legitimate)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setCount(prev => prev + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Effect: event handler disguised as effect (anti-pattern)
  useEffect(() => {
    onTick(count);
  }, [count, onTick]);

  // Effect: fetch-based (anti-pattern in component)
  useEffect(() => {
    fetch('/api/log', {
      method: 'POST',
      body: JSON.stringify({ count }),
    });
  }, [count]);

  return <div>{count}</div>;
}
