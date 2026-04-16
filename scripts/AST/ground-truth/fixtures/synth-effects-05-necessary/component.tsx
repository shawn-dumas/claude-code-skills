import React, { useEffect } from 'react';

interface Props {
  isOpen: boolean;
  title: string;
  analyticsId: string;
}

export function NecessaryEffects({ isOpen, title, analyticsId }: Props) {
  useEffect(() => {}, []);

  useEffect(() => {
    if (isOpen) {
      void 0;
    }
  }, [isOpen]);

  useEffect(() => {
    void analyticsId;
    void title;
  }, [analyticsId, title]);

  return <div>{title}</div>;
}
