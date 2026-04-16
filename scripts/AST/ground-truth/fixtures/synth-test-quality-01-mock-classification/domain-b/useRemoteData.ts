import { useState } from 'react';

export function useRemoteData() {
  const [data, setData] = useState<string[]>([]);
  return { data, setData };
}
