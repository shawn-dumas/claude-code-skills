import React, { useState, useEffect, useRef } from 'react';

interface Props {
  channelId: string;
}

export function DomAndSubscription({ channelId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [channelId]);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/stream/${channelId}`);
    source.onmessage = () => {};
    return () => source.close();
  }, [channelId]);

  useEffect(() => {
    document.title = `Channel ${channelId}`;
  }, [channelId]);

  return <div ref={containerRef}>{width}</div>;
}
