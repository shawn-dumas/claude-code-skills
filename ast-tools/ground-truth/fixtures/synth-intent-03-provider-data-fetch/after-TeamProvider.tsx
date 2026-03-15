import React, { createContext, useState } from 'react';

const TeamContext = createContext(null);

interface TeamProviderProps {
  data: Array<{ id: string }> | undefined;
  children: React.ReactNode;
}

export function TeamProvider({ data, children }: TeamProviderProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return <TeamContext.Provider value={{ data, selectedId, setSelectedId }}>{children}</TeamContext.Provider>;
}
