import React, { useState, useEffect, useRef } from 'react';

interface Props {
  delay: number;
}

export function TimerRace({ delay }: Props) {
  const [count, setCount] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setTimeout(() => {
      setCount(prev => prev + 1);
    }, delay);
  }, [delay]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setVisible(prev => !prev);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return <div>{visible ? count : '...'}</div>;
}
